-- "Send test message" (web button and #pudding test) was removed; its quota
-- log is no longer read or written. Safe to run more than once.

DROP TABLE IF EXISTS public.line_test_sends;
