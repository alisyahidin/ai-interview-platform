# frozen_string_literal: true

class Portfolio < ApplicationRecord
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

  belongs_to :session
  has_many :portfolio_skills, dependent: :destroy
  has_many :assessor_overrides, through: :portfolio_skills

  validates :generation_status, inclusion: { in: GENERATION_STATUSES }

  scope :complete,    -> { where(generation_status: 'complete') }
  scope :failed,      -> { where(generation_status: 'failed') }
  scope :generating,  -> { where(generation_status: 'generating') }

  def complete?    = generation_status == 'complete'
  def generating?  = generation_status == 'generating'
  def failed?      = generation_status == 'failed'
end
