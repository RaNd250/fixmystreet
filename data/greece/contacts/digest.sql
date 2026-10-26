-- The municipalities' reports go in three emails a day per address (bin/greece/send-digest), not one
-- email each from send-reports: their bodies get send_method Noop, which send-reports leaves alone.
-- The police (bodies with greece_police) keep the default, email at once. Run again after new
-- municipalities are added; to go back to one email per report: SET send_method = NULL.
UPDATE body SET send_method = 'Noop'
 WHERE NOT deleted AND (extra->>'greece_police') IS NULL AND name LIKE 'Δήμος %'
   AND send_method IS DISTINCT FROM 'Noop';
