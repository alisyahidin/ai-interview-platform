# frozen_string_literal: true

require "rails_helper"

# Issue #37 (Phase 5 #6, F30/D11): proves `public_id` is present, unique,
# auto-generated, and lookupable for a newly created record of each of the
# four resource types this ticket touches. See
# spec/support/shared_examples/has_public_id_examples.rb for the assertions
# themselves -- kept in one place so all four models are proven identically
# rather than four slightly-different copies drifting apart.
#
# Four distinct models under one shared behavior, so four top-level
# `describe`s (one per `described_class`) fit better here than nesting --
# rubocop:disable RSpec/MultipleDescribes
RSpec.describe Session, type: :model do
  it_behaves_like "a model with a public_id", :session
end

RSpec.describe Portfolio, type: :model do
  it_behaves_like "a model with a public_id", :portfolio
end

RSpec.describe Assessment, type: :model do
  it_behaves_like "a model with a public_id", :assessment
end

RSpec.describe Vacancy, type: :model do
  it_behaves_like "a model with a public_id", :vacancy
end
# rubocop:enable RSpec/MultipleDescribes
