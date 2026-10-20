CREATE FUNCTION organization_defaults() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE previous text; BEGIN previous=coalesce(current_setting('app.org_id',true),'');PERFORM set_config('app.org_id',NEW.id::text,true);INSERT INTO organization_settings(organization_id) VALUES(NEW.id);PERFORM set_config('app.org_id',previous,true);RETURN NEW;END $$;
CREATE TRIGGER organization_defaults AFTER INSERT ON organizations FOR EACH ROW EXECUTE FUNCTION organization_defaults();
CREATE FUNCTION audit_business_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE data jsonb; org uuid; actor uuid; BEGIN
 data=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 org=(data->>'organization_id')::uuid;
 actor=nullif(current_setting('app.actor_id',true),'')::uuid;
 INSERT INTO audit_events(id,organization_id,actor_id,action,target_id) VALUES(gen_random_uuid(),org,actor,TG_TABLE_NAME||'.'||lower(TG_OP),nullif(data->>'id','')::uuid);
 RETURN NULL;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['people','org_units','field_definitions','person_units','person_assets','assets','templates','number_sequences','cards','organization_settings','locations','print_profiles','api_tokens'] LOOP
 EXECUTE format('CREATE TRIGGER audit_mutation AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_business_mutation()',t);
 END LOOP;
END $$;
CREATE TRIGGER never_delete_cards BEFORE DELETE ON cards FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
