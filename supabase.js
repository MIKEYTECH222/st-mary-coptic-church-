
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://gqbtgkshqjvohezbedcz.supabase.co';

const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_RtAvx2vs11ReW7_-Y1hFfA_mNOOo6Ag';

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

