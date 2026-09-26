# frozen_string_literal: true

# #38: no admin-facing "invite a teammate" UI is built this phase --
# generating an OrganizationInvitation is this out-of-band rake task instead,
# matching how the equivalent operational step was handled in earlier phases
# (see contracts.rake / Session#invite_url for the sibling pattern this
# follows).
namespace :invitations do
  desc 'Generate a single-use organization-invitation token and print its registration URL. ' \
       'Usage: rake invitations:create[org_id_or_scheme]'
  task :create, [:organization] => :environment do |_t, args|
    identifier = args[:organization].to_s.strip
    abort 'Usage: rake invitations:create[org_id_or_scheme] (an organizations.id or organizations.scheme)' if identifier.blank?

    organization = if identifier.match?(/\A\d+\z/)
                     Organization.find_by(id: identifier)
                   else
                     Organization.find_by(scheme: identifier)
                   end

    abort "No organization found for '#{identifier}' (checked id and scheme)." unless organization

    invitation = OrganizationInvitation.create!(
      organization_id: organization.id,
      expires_at:      7.days.from_now
    )

    base = ENV.fetch('APP_BASE_URL', 'http://localhost:5173')
    registration_url = "#{base}/signup?token=#{invitation.token}"

    puts "Organization:     #{organization.name} (id=#{organization.id}, scheme=#{organization.scheme})"
    puts "Invitation token: #{invitation.token}"
    puts "Expires at:       #{invitation.expires_at}"
    puts "Registration URL: #{registration_url}"
  end
end
