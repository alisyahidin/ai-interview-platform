# frozen_string_literal: true

# Issue #37 (Phase 5 #6, F30/D11): shared assertions for every model whose
# table got an additive `public_id` column (sessions, portfolios,
# assessments, vacancies) -- proves the column shape and lookup helper
# behave identically across all four rather than re-asserting the same
# thing four separate ways.
#
# Usage (per model spec):
#   RSpec.describe Session, type: :model do
#     it_behaves_like "a model with a public_id", :session
#   end
RSpec.shared_examples "a model with a public_id" do |factory_name|
  # `public_id`'s default is a DB-side function (`gen_random_uuid()`), like
  # this schema's other function-defaulted columns (e.g. `overridden_at
  # default -> { "now()" }`) -- Postgres fills it in at INSERT time, but
  # Rails doesn't read it back onto the in-memory object without a reload.
  let(:record) { create(factory_name).reload }

  it "auto-generates a public_id on create" do
    expect(record.public_id).to be_present
  end

  it "generates a real UUID string" do
    expect(record.public_id).to match(/\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/i)
  end

  it "generates a distinct public_id for each new record" do
    other = create(factory_name).reload
    expect(other.public_id).not_to eq(record.public_id)
  end

  # update_column deliberately bypasses validations here -- the point of
  # this example is to prove the DB's own unique index rejects a duplicate,
  # not to exercise any (currently nonexistent) model-level validation.
  it "enforces public_id uniqueness at the database level" do # rubocop:disable RSpec/ExampleLength
    other = create(factory_name)
    write_duplicate = lambda do
      ActiveRecord::Base.transaction(requires_new: true) do
        other.update_column(:public_id, record.public_id) # rubocop:disable Rails/SkipsModelValidations
      end
    end
    expect(&write_duplicate).to raise_error(ActiveRecord::RecordNotUnique)
  end

  it "is findable by public_id via .find_by_public_id!" do
    expect(described_class.find_by_public_id!(record.public_id)).to eq(record) # rubocop:disable Rails/DynamicFindBy
  end

  it "raises RecordNotFound for an unknown public_id" do
    expect do
      described_class.find_by_public_id!(SecureRandom.uuid) # rubocop:disable Rails/DynamicFindBy
    end.to raise_error(ActiveRecord::RecordNotFound)
  end

  # #41: a lookup keyed on the record's own old sequential id (not a UUID at
  # all) must 404 like any other unknown identifier -- never a 500 from
  # Postgres rejecting the type, and never a silent fallback to a numeric
  # lookup.
  it "raises RecordNotFound (not a DB type error) for the record's own sequential id" do
    expect do
      described_class.find_by_public_id!(record.id.to_s) # rubocop:disable Rails/DynamicFindBy
    end.to raise_error(ActiveRecord::RecordNotFound)
  end
end
