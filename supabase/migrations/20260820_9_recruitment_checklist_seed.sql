-- Makes onboarding_checklist_items seedable idempotently (mirrors holidays'
-- own (tenant_id, date) unique-constraint precedent), then seeds Raniwala's
-- tenant with joining-formality items straight out of their SOP (steps 9,
-- 12-16: IT/Admin setup, documents, induction, buddy, factory visit).
-- initializeMajorHolidays() in tenantService.js is the reference pattern
-- this mirrors; seedRecruitmentChecklist() in onboardingService.js reuses
-- the same upsert-with-ignoreDuplicates shape for any tenant going forward.

ALTER TABLE onboarding_checklist_items DROP CONSTRAINT IF EXISTS onboarding_checklist_items_tenant_title_key;
ALTER TABLE onboarding_checklist_items ADD CONSTRAINT onboarding_checklist_items_tenant_title_key UNIQUE (tenant_id, title);

INSERT INTO onboarding_checklist_items (tenant_id, title, description, category, sort_order) VALUES
  ('123c949a-329f-4a48-bb25-eed41a390cf4', 'Laptop/Desktop assigned',        'IT allocates the joiner''s laptop or desktop.',              'IT Setup',  10),
  ('123c949a-329f-4a48-bb25-eed41a390cf4', 'Company email created',          'Official email ID created for the new joiner.',              'IT Setup',  20),
  ('123c949a-329f-4a48-bb25-eed41a390cf4', 'Phone/extension provisioned',    'Mobile phone or extension allocated, if applicable.',        'IT Setup',  30),
  ('123c949a-329f-4a48-bb25-eed41a390cf4', 'Required software installed',    'Required software installed and system access granted.',    'IT Setup',  40),
  ('123c949a-329f-4a48-bb25-eed41a390cf4', 'Desk/workstation assigned',      'Workstation/seating arrangement confirmed.',                 'Admin Setup', 10),
  ('123c949a-329f-4a48-bb25-eed41a390cf4', 'Stationery kit issued',          'Stationery requirements fulfilled.',                         'Admin Setup', 20),
  ('123c949a-329f-4a48-bb25-eed41a390cf4', 'Access card/biometric enrolled', 'Department-specific access requirements set up.',            'Admin Setup', 30),
  ('123c949a-329f-4a48-bb25-eed41a390cf4', 'Joining Form signed',            'Joining Form signed and filed.',                             'Documents', 10),
  ('123c949a-329f-4a48-bb25-eed41a390cf4', 'Offer Letter signed',            'Offer Letter signed and filed.',                             'Documents', 20),
  ('123c949a-329f-4a48-bb25-eed41a390cf4', 'Appointment Letter signed',      'Appointment Letter signed and filed.',                       'Documents', 30),
  ('123c949a-329f-4a48-bb25-eed41a390cf4', 'NDA signed',                     'Non-Disclosure Agreement signed and filed.',                 'Documents', 40),
  ('123c949a-329f-4a48-bb25-eed41a390cf4', 'PF Form submitted',              'PF Form completed, if applicable.',                          'Documents', 50),
  ('123c949a-329f-4a48-bb25-eed41a390cf4', 'ESIC Form submitted',            'ESIC Form completed, if applicable.',                        'Documents', 60),
  ('123c949a-329f-4a48-bb25-eed41a390cf4', 'Induction PPT delivered',        'Company induction presentation walked through.',            'Induction', 10),
  ('123c949a-329f-4a48-bb25-eed41a390cf4', 'Company policies shared',        'Policies, code of conduct, org structure and culture covered.', 'Induction', 20),
  ('123c949a-329f-4a48-bb25-eed41a390cf4', 'Employee handbook shared',       'Employee Handbook and Policy Manual shared.',                'Induction', 30),
  ('123c949a-329f-4a48-bb25-eed41a390cf4', 'KRA handed over',                'Approved KRAs handed over to the new joiner.',               'Induction', 40),
  ('123c949a-329f-4a48-bb25-eed41a390cf4', 'Buddy introduced',               'Buddy assigned and introduced for the first 15 days.',       'Buddy', 10),
  ('123c949a-329f-4a48-bb25-eed41a390cf4', 'First-week check-in completed',  'Buddy check-in during the first week of joining.',           'Buddy', 20),
  ('123c949a-329f-4a48-bb25-eed41a390cf4', 'Factory visit scheduled',        'Factory HR schedules a factory walkthrough for applicable joiners.', 'Factory Visit', 10),
  ('123c949a-329f-4a48-bb25-eed41a390cf4', 'Production orientation completed', 'Manufacturing process, safety guidelines, and quality standards covered.', 'Factory Visit', 20)
ON CONFLICT (tenant_id, title) DO NOTHING;
