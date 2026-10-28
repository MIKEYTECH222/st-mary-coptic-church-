
import { supabase } from "./supabase.js";

/**
 * تعيين خادم لمجموعة.
 * قاعدة البيانات تسمح بالتعيين للأدمن المعتمد فقط.
 */
export async function assignServantToGroup(servantId, groupId) {
  if (!servantId || !groupId) {
    throw new Error("اختار الخادم والمجموعة.");
  }

  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error("سجّل الدخول بحساب الأدمن أولًا.");
  }

  const { error } = await supabase
    .from("servant_group_assignments")
    .upsert(
      {
        servant_id: servantId,
        group_id: groupId,
        assigned_by: user.id
      },
      {
        onConflict: "servant_id,group_id"
      }
    );

  if (error) {
    throw new Error(error.message);
  }

  return true;
}

/**
 * عرض المجموعات المسندة إلى الخادم الحالي.
 */
export async function getMyAssignedGroups() {
  const { data, error } = await supabase
    .from("servant_group_assignments")
    .select("group_id, ministry_groups(id, name)");

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}
