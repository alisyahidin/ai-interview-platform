class AddConsentAndConnectivityAdvisoryToSessions < ActiveRecord::Migration[7.0]
  def change
    change_table :sessions, bulk: true do |t|
      # F14/AC27: when the candidate explicitly acknowledges the pre-interview
      # recording/AI notice, before any microphone access is attempted.
      t.column :consent_given_at, :datetime

      # F12: when the candidate chooses to continue past a connectivity
      # advisory warning instead of being hard-blocked.
      t.column :connectivity_advisory_acknowledged, :datetime
    end
  end
end
