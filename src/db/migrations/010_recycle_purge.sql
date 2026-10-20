ALTER TABLE purge_requests DROP CONSTRAINT purge_requests_kind_check;
ALTER TABLE purge_requests ADD CONSTRAINT purge_requests_kind_check CHECK(kind IN ('audit','renders','jobs','recycle'));

CREATE FUNCTION recycle_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request purge_requests; actor uuid; record_id uuid; BEGIN
 IF TG_OP <> 'DELETE' THEN RAISE EXCEPTION 'History records are immutable'; END IF;
 actor=nullif(current_setting('app.actor_id',true),'')::uuid;
 record_id=CASE WHEN TG_TABLE_NAME='cards' THEN OLD.id ELSE (to_jsonb(OLD)->>'card_id')::uuid END;
 SELECT * INTO request FROM purge_requests WHERE id=nullif(current_setting('app.purge_request',true),'')::uuid
 AND organization_id=OLD.organization_id AND actor_id=actor AND status='RUNNING' AND expires_at>now()
 AND kind='recycle' AND manifest->'cards' ? record_id::text;
 IF request.id IS NULL OR NOT EXISTS(SELECT 1 FROM users u WHERE u.id=actor AND NOT u.disabled AND NOT u.must_change_password AND
 (u.super_admin OR EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.organization_id=OLD.organization_id AND m.role='ORG_ADMIN')))
 THEN RAISE EXCEPTION 'History records are immutable; use an authorized recycle bin preview'; END IF;
 RETURN OLD;
END $$;
DROP TRIGGER never_delete_cards ON cards;
CREATE TRIGGER never_delete_cards BEFORE DELETE ON cards FOR EACH ROW EXECUTE FUNCTION recycle_delete_guard();
DROP TRIGGER immutable_card_events ON card_events;
CREATE TRIGGER immutable_card_events BEFORE UPDATE OR DELETE ON card_events FOR EACH ROW EXECUTE FUNCTION recycle_delete_guard();

CREATE OR REPLACE FUNCTION retention_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request purge_requests; actor uuid; BEGIN
 IF TG_OP <> 'DELETE' THEN RAISE EXCEPTION 'History records are immutable'; END IF;
 IF TG_TABLE_NAME='audit_events' AND to_jsonb(OLD)->>'action'='retention.purge' THEN RAISE EXCEPTION 'Purge receipts are immutable'; END IF;
 actor=nullif(current_setting('app.actor_id',true),'')::uuid;
 SELECT * INTO request FROM purge_requests WHERE id=nullif(current_setting('app.purge_request',true),'')::uuid
 AND organization_id=OLD.organization_id AND actor_id=actor AND status='RUNNING' AND expires_at>now()
 AND ((kind=CASE WHEN TG_TABLE_NAME='audit_events' THEN 'audit' ELSE 'renders' END AND manifest->'ids' ? OLD.id::text)
 OR (TG_TABLE_NAME='card_renders' AND kind='recycle' AND manifest->'renders' ? OLD.id::text));
 IF request.id IS NULL OR NOT EXISTS(SELECT 1 FROM users u WHERE u.id=actor AND NOT u.disabled AND NOT u.must_change_password AND
 (u.super_admin OR EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.organization_id=OLD.organization_id AND m.role='ORG_ADMIN')))
 THEN RAISE EXCEPTION 'History records are immutable; use an authorized purge preview'; END IF;
 RETURN OLD;
END $$;
