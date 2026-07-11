-- 택시팟 찜 인원이 성사 기준인 최소 인원에 처음 도달하면 관리자 이메일 job을 생성합니다.
-- Supabase SQL Editor에서 한 번 실행하세요.

CREATE OR REPLACE FUNCTION public.enqueue_taxi_pot_capacity_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_pot_id uuid := COALESCE(NEW.taxi_pot_id, OLD.taxi_pot_id);
  pot public.taxi_pots%ROWTYPE;
  current_people integer;
BEGIN
  SELECT * INTO pot
  FROM public.taxi_pots
  WHERE id = target_pot_id
  FOR UPDATE;

  IF NOT FOUND OR pot.status <> 'open' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT count(*)::integer INTO current_people
  FROM public.taxi_pot_saves
  WHERE taxi_pot_id = target_pot_id;

  IF pot.min_people IS NOT NULL
     AND current_people >= pot.min_people
     AND NOT pot.min_people_notified THEN
    INSERT INTO public.notification_jobs (
      taxi_pot_id, event_type, channel, email, subject, message
    ) VALUES (
      target_pot_id,
      'min_people_reached',
      'email',
      NULL,
      format('[콘택시] %s 택시팟 최소 인원 도달', pot.concert_title),
      format('%s → %s 택시팟이 최소 인원 %s명에 도달했습니다. 현재 찜 인원: %s명',
        pot.origin, pot.destination, pot.min_people, current_people)
    );

    UPDATE public.taxi_pots
    SET min_people_notified = true
    WHERE id = target_pot_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS taxi_pot_capacity_notification_trigger
ON public.taxi_pot_saves;

CREATE TRIGGER taxi_pot_capacity_notification_trigger
AFTER INSERT ON public.taxi_pot_saves
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_taxi_pot_capacity_notification();

-- 아래 이메일을 실제 관리자 이메일로 바꿔 실행하세요.
-- INSERT INTO public.admin_notification_emails (email)
-- VALUES ('admin@example.com')
-- ON CONFLICT (email) DO UPDATE SET is_active = true;
