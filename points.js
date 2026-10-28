
import { supabase } from "./supabase.js";

/**
 * إضافة نقاط أو خصم نقاط لعضو.
 * الصلاحيات الحقيقية يتم التحقق منها داخل قاعدة البيانات.
 */
export async function awardPoints(memberId, amount, reason) {
  if (!memberId) {
    throw new Error("اختار العضو الأول.");
  }

  const points = Number(amount);

  if (!Number.isInteger(points) || points === 0 ||
      points < -100 || points > 100) {
    throw new Error("عدد النقاط لازم يكون عددًا صحيحًا بين -100 و100، بدون صفر.");
  }

  if (!reason || !reason.trim() || reason.trim().length > 200) {
    throw new Error("اكتب سبب إضافة أو خصم النقاط.");
  }

  const { error } = await supabase.rpc("award_points", {
    p_member_id: memberId,
    p_amount: points,
    p_reason: reason.trim()
  });

  if (error) {
    throw new Error(error.message);
  }

  return true;
}
