
UPDATE public.crm_messages
SET content = COALESCE(
  raw->'msgContent'->>'conversation',
  raw->'msgContent'->'extendedTextMessage'->>'text',
  raw->'msgContent'->'encodedTextMessage'->>'text',
  raw->'msgContent'->'imageMessage'->>'caption',
  raw->'msgContent'->'videoMessage'->>'caption',
  raw->'msgContent'->'documentMessage'->>'caption',
  raw->'msgContent'->'buttonsResponseMessage'->>'selectedDisplayText',
  raw->'msgContent'->'listResponseMessage'->>'title',
  raw->>'text',
  raw->>'body',
  raw->'message'->>'text',
  raw->>'conversation'
)
WHERE content IS NULL
  AND raw IS NOT NULL;
