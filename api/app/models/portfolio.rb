# frozen_string_literal: true

class Portfolio < ApplicationRecord
  include TenantScoped
  include HasPublicId

  GENERATION_STATUSES = %w[pending generating complete failed].freeze

  # `model_name` (PR2/#6: which Gemini model produced this portfolio's
  # scores) is a real column, but ActiveRecord::Base already defines an
  # *instance-level* `model_name` (it delegates to `self.class.model_name`
  # via `extend ActiveModel::Naming`, which every AR model needs for
  # routing/i18n). That makes any column literally named `model_name` a
  # `DangerousAttributeError` by default. The column name is fixed by the
  # schema/API contract (#4), so rather than rename it, this narrowly lets
  # that one attribute past the safety check; the generated reader/writer
  # for the real column then shadows the naming delegate on instances only
  # -- `Portfolio.model_name` (the class method Rails itself relies on)
  # is untouched.
  def self.instance_method_already_implemented?(method_name)
    return false if method_name.to_s == "model_name"

    super
  end

  # ActiveRecord::Base normally gives every instance a `#model_name` that
  # delegates to `self.class.model_name` (an ActiveModel::Name) -- used
  # internally by ActiveModel::Errors#full_message for i18n lookups. Since
  # the bypass above lets AR generate a real reader for the `model_name`
  # COLUMN, that reader shadows the delegate, so any invalid Portfolio
  # instance blows up on `errors.full_messages`/`errors[:attr]` with
  # `NoMethodError: undefined method 'human' for nil` instead of a normal
  # validation message. Restore the delegate explicitly; read the stored
  # Gemini model string via `self[:model_name]` (the writer `model_name=`
  # is unaffected -- it doesn't collide with anything).
  delegate :model_name, to: :class

  belongs_to :session
  has_many :portfolio_skills, dependent: :destroy
  has_many :assessor_overrides, through: :portfolio_skills

  validates :generation_status, inclusion: { in: GENERATION_STATUSES }

  scope :complete,    -> { where(generation_status: 'complete') }
  scope :failed,      -> { where(generation_status: 'failed') }
  scope :generating,  -> { where(generation_status: 'generating') }

  # The one construction point for a freshly-ended session's not-yet-run
  # portfolio. `Sessions::EndHandler` uses this to create the record;
  # `Portfolios::Generator#call` uses it (via `session.create_portfolio!`
  # with the same attributes) to lazily create one if `EndHandler` somehow
  # hasn't already -- keeping both call sites in sync so a future field
  # addition to "what a pending portfolio looks like" is a one-file change.
  def self.pending_for(session:)
    session.portfolio || session.create_portfolio!(
      candidate_id:      session.candidate_id,
      generation_status: 'pending',
      tenant_id:         session.tenant_id
    )
  end

  def complete?    = generation_status == 'complete'
  def generating?  = generation_status == 'generating'
  def failed?      = generation_status == 'failed'

  # The raw Gemini model-name string stored in the `model_name` column
  # (PR2/#6: which model produced this portfolio's scores). Named
  # deliberately instead of `.model_name`: that instance method is
  # restored to ActiveModel::Naming's normal delegate (see the comment
  # above `instance_method_already_implemented?`), so it returns this
  # class's `ActiveModel::Name`, not the stored string.
  def gemini_model_name
    self[:model_name]
  end
end
