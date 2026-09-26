# frozen_string_literal: true

module Api
  module V1
    class SessionsController < ApiController
      CANDIDATE_TOKEN_ACTIONS = %i[candidate_info audio_complete acknowledge_consent
                                    acknowledge_connectivity_advisory].freeze

      authorize_auth_token! :assessor, except: CANDIDATE_TOKEN_ACTIONS
      skip_before_action :require_tenant!, only: CANDIDATE_TOKEN_ACTIONS

      before_action :set_session, only: %i[show end_session coverage transcript reinvite]
      before_action :set_candidate_session, only: %i[candidate_info acknowledge_consent
                                                       acknowledge_connectivity_advisory]

      # GET /api/v1/assessments/:assessment_id/sessions
      def index
        assessment = Assessment.find(params[:assessment_id])
        sessions = assessment.sessions.order(created_at: :desc)

        json_response(sessions: sessions.map(&method(:session_json)))
      rescue ActiveRecord::RecordNotFound
        json_error("Assessment not found", :not_found)
      end

      # GET /api/v1/sessions/:id
      def show
        json_response(
          session: session_json(@session).merge(
            assessment: {
              id:             @session.assessment.id,
              name:           @session.assessment.name,
              time_limit_min: @session.assessment.time_limit_min
            }
          )
        )
      end
      # POST /api/v1/assessments/:assessment_id/sessions
      def create
        assessment = Assessment.find(params[:assessment_id])

        session = assessment.sessions.new(
          candidate_id:   params.dig(:session, :candidate_id),
          candidate_name: params.dig(:session, :candidate_name).presence,
          tenant_id:      current_tenant_id
        )

        if session.save
          # public_id (#37) is a DB-side gen_random_uuid() default -- reload
          # so the in-memory record (and therefore session_json's public_id)
          # reflects the value Postgres actually generated, not nil.
          json_response(
            {
              session:    session_json(session.reload),
              invite_url: session.invite_url
            },
            :created
          )
        else
          json_error(session.errors.full_messages.first, :unprocessable_entity)
        end
      rescue ActiveRecord::RecordNotFound
        json_error("Assessment not found", :not_found)
      end


      # POST /api/v1/sessions/:id/end
      def end_session
        if @session.ended?
          return json_error("Session is already ended", :unprocessable_entity)
        end

        reason = params.dig(:session, :reason) || "manual_assessor"

        unless Session::END_REASONS.include?(reason)
          return json_error("Invalid end reason", :unprocessable_entity)
        end

        result = Sessions::EndHandler.new(@session).call(reason: reason)

        if result
          json_response(session: session_json(@session.reload))
        else
          json_error("Failed to end session", :unprocessable_entity)
        end
      end

      # GET /api/v1/sessions/:id/coverage
      def coverage
        maps       = @session.coverage_maps.configured.order(:id)
        discovered = @session.coverage_maps.discovered.order(:id)

        json_response(
          skills:     maps.map(&method(:coverage_map_json)),
          discovered: discovered.map(&method(:coverage_map_json)),
          updated_at: @session.coverage_maps.maximum(:updated_at)
        )
      end

      # GET /api/v1/sessions/:id/transcript
      def transcript
        from_turn = params[:from_turn].to_i
        turns     = @session.transcript_turns
                             .ordered
                             .then { from_turn > 0 ? _1.where(turn_number: from_turn..) : _1 }

        json_response(
          turns: turns.map do |t|
            {
              id:             t.id,
              turn_number:    t.turn_number,
              speaker:        t.speaker,
              text:           t.text,
              audio_start_ms: t.audio_start_ms,
              audio_end_ms:   t.audio_end_ms,
              created_at:     t.created_at
            }
          end,
          total: turns.count
        )
      end

      # POST /api/v1/sessions/:id/reinvite
      # Assessor-authenticated. Issues a brand-new session (and invite token) for the
      # same candidate/assessment when the original session ended in a terminal
      # failed state (#29/F5). The original session is left completely unmodified
      # so its history (partial transcript, audio, timestamps) is preserved.
      def reinvite
        unless @session.failed?
          return json_error(
            "Session can only be re-invited from a terminal failed state (status: ended, end_reason: error)",
            :unprocessable_entity
          )
        end

        new_session = Session.create!(
          assessment_id:  @session.assessment_id,
          tenant_id:      @session.tenant_id,
          candidate_id:   @session.candidate_id,
          candidate_name: @session.candidate_name
        )

        # public_id (#37) is a DB-side gen_random_uuid() default -- reload so
        # session_json's public_id reflects the generated value, not nil.
        new_session.reload

        json_response(
          {
            session:    session_json(new_session),
            invite_url: new_session.invite_url
          },
          :created
        )
      end

      # POST /sessions/:token/audio_complete  — no JWT, invite token in URL
      # Called by the frontend when the audio queue drains after a preparing_to_end signal.
      # Ends the session if all coverage is complete; idempotent if already ended.
      def audio_complete
        session = Session.unscoped.find_by(invite_token: params[:token])
        return json_error("Invalid or expired invite token", :not_found) unless session

        return json_response(ended: true, message: "Session already ended") if session.ended?

        # No coverage re-check here. The backend WS already verified all_covered
        # before sending preparing_to_end. Re-checking here caused false negatives
        # (timing gap between WS detection and HTTP call) that stalled auto-end.
        Sessions::EndHandler.new(session).call(reason: 'all_covered')
        json_response(ended: true, message: "Session ended")
      end

      # GET /sessions/:token/candidate  — no JWT, invite token in URL
      def candidate_info
        # Resolve tenant from the session's own tenant_id so we can load the assessment
        assessment = Assessment.unscoped
                               .where(tenant_id: @candidate_session.tenant_id)
                               .find_by(id: @candidate_session.assessment_id)

        unless assessment
          return json_error("Assessment not found", :not_found)
        end

        json_response(
          session_id:      @candidate_session.id,
          role_title:      assessment.name,
          time_limit_min:  assessment.time_limit_min,
          session_status:  @candidate_session.status,
          end_reason:      @candidate_session.end_reason,
          language:        assessment.language
        )
      end

      # POST /sessions/:token/consent  — no JWT, invite token in URL
      # Records that the candidate explicitly acknowledged the pre-interview
      # recording/AI notice, before any microphone access is attempted (F14/AC27/AC18).
      def acknowledge_consent
        @candidate_session.update!(consent_given_at: Time.current)

        json_response(
          session_id:        @candidate_session.id,
          consent_given_at:  @candidate_session.consent_given_at
        )
      end

      # POST /sessions/:token/connectivity_advisory  — no JWT, invite token in URL
      # Records that the candidate chose to continue past a connectivity advisory
      # warning instead of being hard-blocked, so the assessor can see the context (F12).
      def acknowledge_connectivity_advisory
        @candidate_session.update!(connectivity_advisory_acknowledged: Time.current)

        json_response(
          session_id: @candidate_session.id,
          connectivity_advisory_acknowledged: @candidate_session.connectivity_advisory_acknowledged
        )
      end

      private

      def set_session
        @session = Session.find_by_public_id!(params[:public_id]) # rubocop:disable Rails/DynamicFindBy
      rescue ActiveRecord::RecordNotFound
        json_error("Session not found", :not_found)
      end

      # Candidate-facing actions authenticate by invite token, not JWT/tenant (see
      # CANDIDATE_TOKEN_ACTIONS) — mirrors the pre-existing candidate_info/audio_complete
      # pattern of scoping to the session identified by its own invite token.
      def set_candidate_session
        @candidate_session = Session.unscoped.find_by(invite_token: params[:token])

        unless @candidate_session
          json_error("Invalid or expired invite token", :not_found)
        end
      end

      def session_json(session)
        {
          public_id:        session.public_id,
          assessment_id:    session.assessment_id,
          tenant_id:        session.tenant_id,
          candidate_id:     session.candidate_id,
          candidate_name:   session.candidate_name,
          invite_token:     session.invite_token,
          invite_url:       session.invite_url,
          status:           session.status,
          end_reason:       session.end_reason,
          started_at:       session.started_at,
          ended_at:         session.ended_at,
          duration_seconds: session.duration_seconds,
          created_at:       session.created_at,
          consent_given_at: session.consent_given_at,
          connectivity_advisory_acknowledged: session.connectivity_advisory_acknowledged
        }
      end

      def coverage_map_json(map)
        {
          id:            map.id,
          skill_id:      map.skill_id,
          skill_label:   map.skill_label,
          is_discovered: map.is_discovered,
          state:         map.state,
          probe_count:   map.probe_count,
          last_signal:   map.last_signal,
          updated_at:    map.updated_at
        }
      end
    end
  end
end
