import { supabase } from "./supabase.js";
const $ = id => document.getElementById(id);
let questions = [], attempts = [], quiz = null;
function say(text){$("message").textContent=text||"";}
function el(tag,cls,text){const x=document.createElement(tag);if(cls)x.className=cls;if(text!==undefined)x.textContent=text;return x;}
async function init(){
 const {data:{user},error:ae}=await supabase.auth.getUser();
 if(ae||!user){location.replace("account.html");return;}
 const {data:p,error:pe}=await supabase.from("profiles").select("role,approval_status").eq("id",user.id).maybeSingle();
 if(pe||!p||p.approval_status!=="approved"||!["admin","servant"].includes(p.role)){say("الصفحة للخدام والأدمن المعتمدين فقط.");return;}
 const {data:list,error}=await supabase.rpc("get_reviewable_quizzes");
 if(error){say("تعذر تحميل الامتحانات: "+error.message);return;}
 $("quizSelect").replaceChildren(new Option("اختار الامتحان",""));
 (list||[]).forEach(q=>$("quizSelect").add(new Option(q.title,q.id)));
 if(!list?.length)say("لا توجد امتحانات ضمن صلاحياتك.");
}
async function load(){
 const id=$("quizSelect").value;if(!id){say("اختار الامتحان.");return;}
 say("جاري تحميل الإجابات...");
 const {data,error}=await supabase.rpc("get_essay_review_data",{p_quiz_id:id});
 if(error){say("تعذر التحميل: "+error.message);return;}
 quiz=data.quiz;questions=data.questions||[];attempts=data.attempts||[];
 render();say(`تم تحميل ${attempts.length} محاولة تنتظر مراجعة المقالي.`);
}
function render(){
 const root=$("attempts");root.replaceChildren();
 if(!questions.length){root.append(el("p","muted","الامتحان لا يحتوي على أسئلة مقالية."));return;}
 if(!attempts.length){root.append(el("p","muted","لا توجد إجابات مقالية معلقة لهذا الامتحان."));return;}
 attempts.forEach(attempt=>{
  const card=el("article","attempt");
  card.append(el("h2","",attempt.member_name||"مخدوم"));
  card.append(el("p","muted","تاريخ التسليم: "+new Date(attempt.submitted_at).toLocaleString("ar-EG")));
  const scores={};
  questions.forEach((q,i)=>{
   const block=el("section","essay");
   block.append(el("h3","",`${i+1}. ${q.question_text} • ${q.max_points} درجة`));
   const grid=el("div","grid");
   const expected=el("div");expected.append(el("strong","","الإجابة النموذجية"),el("div","answer",q.expected_answer||""));
   const studentAnswer=attempt.answers?.[q.id]??"";
   const answer=el("div");answer.append(el("strong","","إجابة الطالب"),el("div","answer",studentAnswer||"لم يكتب إجابة"));
   grid.append(expected,answer);block.append(grid);
   const suggestion=attempt.essay_suggestions?.[q.id]||{};
   const hint=el("p","muted",`نسبة تشابه الكلمات: ${suggestion.match_percent??0}% • الدرجة المقترحة آليًا: ${suggestion.suggested_score??0} من ${q.max_points}`);
   block.append(hint);
   const label=el("label","","الدرجة التي تعتمدها بعد المراجعة");
   const input=el("input");input.type="number";input.min="0";input.max=String(q.max_points);input.step="1";input.value=String(suggestion.suggested_score??0);input.dataset.questionId=q.id;
   label.append(input);block.append(label);card.append(block);
  });
  const btn=el("button","primary","اعتماد الدرجة النهائية");
  btn.addEventListener("click",async()=>{
   const scoreInputs=[...card.querySelectorAll("input[data-question-id]")];
   for(const input of scoreInputs){
    const value=Number(input.value),max=Number(input.max);
    if(!Number.isInteger(value)||value<0||value>max){say("راجع الدرجات: كل درجة لازم تكون رقم صحيح داخل الحد المسموح.");return;}
    scores[input.dataset.questionId]=value;
   }
   btn.disabled=true;say("جاري اعتماد الدرجة...");
   const {data,error}=await supabase.rpc("finalize_essay_review",{p_attempt_id:attempt.id,p_scores:scores});
   btn.disabled=false;
   if(error){say("تعذر اعتماد الدرجة: "+error.message);return;}
   card.remove();say(`تم اعتماد ${data.score} من ${data.max_score} وإضافة ${data.points_awarded} نقطة.`);
   if(!$("attempts").children.length) say("تمت مراجعة كل الإجابات المقالية في هذا الامتحان.");
  });
  card.append(btn);root.append(card);
 });
}
$("loadBtn").addEventListener("click",load);
$("quizSelect").addEventListener("change",load);
await init();
