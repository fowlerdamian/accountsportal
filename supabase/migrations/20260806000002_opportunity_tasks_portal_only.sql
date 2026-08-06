-- Opportunity tasks are staff-portal-only: no HubSpot task objects are
-- created or reconciled, so the write-back linkage table is retired.
-- staff_tasks.opportunity_id remains the single source of the task↔deal link.
drop table if exists public.opportunity_task_sync;
