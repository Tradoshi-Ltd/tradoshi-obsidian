import type { Question, TemplateId } from "./questions";

// The questions a trader starts with, in the four languages of Tradoshi. Short on
// purpose: a review is useful when it is done every day. Each set is a starting point,
// changed in "Review questions". The ids are the same in every language, so answers
// written in one language are read in another; the choices of a question, written as
// text, are the trader's own once saved.

export type Lang = "en" | "fr" | "es" | "pt";

type Dict = Record<TemplateId, Question[]>;

const q = (id: string, text: string, extra: Partial<Question> = {}): Question => ({ id, text, kind: "text", ...extra });

const en: Dict = {
	pre: [
		q("bias", "What is your bias today, and why?", { hint: "Higher timeframe trend, where price is against the key levels" }),
		q("levels", "Which levels and setups are you waiting for?"),
		q("max_loss", "Your loss limit and maximum number of trades today", { hint: "For example: −2 R or 3 trades" }),
		q("focus", "Energy and focus right now", { kind: "scale" }),
	],
	post: [
		q("grade", "Grade your execution today", { kind: "scale" }),
		q("rules", "Did you follow all your rules?", { kind: "yesno" }),
		q("broken_rule", "Which rule did you break, and what led you to it?", { showWhen: { id: "rules", value: "no" } }),
		q("well", "What did you do well?"),
		q("tomorrow", "What will you do differently tomorrow?", { carry: true }),
	],
	win: [
		q("thesis", "Why did you take this trade?"),
		q("in_plan", "Was it one of your setups, with every condition met?", { kind: "yesno" }),
		q("exit", "How did you exit?", { kind: "choice", options: ["At my target", "Trailed my stop", "Too early", "Too late"] }),
		q("lesson", "What made it work, and can you do it again?"),
	],
	loss: [
		q("thesis", "Why did you take this trade?"),
		q("in_plan", "Was it one of your setups, with every condition met?", { kind: "yesno" }),
		q("mistake", "What went wrong?", { kind: "choice", options: ["Entry", "Stop", "Size", "Exit", "Emotions", "Nothing: a normal loss"] }),
		q("respected_stop", "Did you respect your stop?", { kind: "yesno" }),
		q("lesson", "What will you change next time?"),
	],
	even: [
		q("thesis", "Why did you take this trade?"),
		q("be_planned", "Was moving the stop to break-even part of your plan?", { kind: "yesno" }),
		q("lesson", "What do you learn from it?"),
	],
	week: [
		q("grade", "Grade your week", { kind: "scale" }),
		q("best", "What worked best this week?"),
		q("worst", "Which mistake cost you the most?"),
		q("pattern", "Do you see a pattern: a day, an hour, a setup, a mood?"),
		q("focus", "One focus for next week", { carry: true }),
	],
	month: [
		q("grade", "Grade your month", { kind: "scale" }),
		q("edge", "Which setups carried the month, and which ones should you drop?"),
		q("risk", "Did you keep your risk within your limits all month?", { kind: "yesno" }),
		q("change", "What will you change in your process next month?", { carry: true }),
	],
	quarter: [
		q("grade", "Grade your quarter", { kind: "scale" }),
		q("progress", "How far are you from your goals for the year?"),
		q("strategy", "What should change in your strategy or your risk?"),
		q("goals", "Your goals for the next quarter", { carry: true }),
	],
	year: [
		q("grade", "Grade your year", { kind: "scale" }),
		q("lessons", "Your three biggest lessons of the year"),
		q("figures", "Which figure improved most, and which got worse?"),
		q("goals", "Your goals for next year", { carry: true }),
	],
};

const fr: Dict = {
	pre: [
		q("bias", "Quel est ton biais aujourd'hui, et pourquoi ?", { hint: "Tendance de fond, position du prix face aux niveaux clés" }),
		q("levels", "Quels niveaux et quels setups attends-tu ?"),
		q("max_loss", "Ta limite de perte et ton nombre maximal de trades aujourd'hui", { hint: "Par exemple : −2 R ou 3 trades" }),
		q("focus", "Ton énergie et ta concentration en ce moment", { kind: "scale" }),
	],
	post: [
		q("grade", "Note ton exécution du jour", { kind: "scale" }),
		q("rules", "As-tu respecté toutes tes règles ?", { kind: "yesno" }),
		q("broken_rule", "Quelle règle as-tu enfreinte, et qu'est-ce qui t'y a poussé ?", { showWhen: { id: "rules", value: "no" } }),
		q("well", "Qu'as-tu bien fait ?"),
		q("tomorrow", "Que feras-tu autrement demain ?", { carry: true }),
	],
	win: [
		q("thesis", "Pourquoi as-tu pris ce trade ?"),
		q("in_plan", "Était-ce un de tes setups, toutes conditions réunies ?", { kind: "yesno" }),
		q("exit", "Comment es-tu sorti ?", { kind: "choice", options: ["À mon objectif", "Stop suiveur", "Trop tôt", "Trop tard"] }),
		q("lesson", "Qu'est-ce qui a marché, et peux-tu le refaire ?"),
	],
	loss: [
		q("thesis", "Pourquoi as-tu pris ce trade ?"),
		q("in_plan", "Était-ce un de tes setups, toutes conditions réunies ?", { kind: "yesno" }),
		q("mistake", "Qu'est-ce qui n'a pas marché ?", { kind: "choice", options: ["L'entrée", "Le stop", "La taille", "La sortie", "Les émotions", "Rien : une perte normale"] }),
		q("respected_stop", "As-tu respecté ton stop ?", { kind: "yesno" }),
		q("lesson", "Que changeras-tu la prochaine fois ?"),
	],
	even: [
		q("thesis", "Pourquoi as-tu pris ce trade ?"),
		q("be_planned", "Remonter le stop au point mort faisait-il partie de ton plan ?", { kind: "yesno" }),
		q("lesson", "Qu'en retiens-tu ?"),
	],
	week: [
		q("grade", "Note ta semaine", { kind: "scale" }),
		q("best", "Qu'est-ce qui a le mieux marché cette semaine ?"),
		q("worst", "Quelle erreur t'a coûté le plus ?"),
		q("pattern", "Vois-tu une constante : un jour, une heure, un setup, un état d'esprit ?"),
		q("focus", "Un seul axe de travail pour la semaine prochaine", { carry: true }),
	],
	month: [
		q("grade", "Note ton mois", { kind: "scale" }),
		q("edge", "Quels setups ont porté le mois, et lesquels abandonner ?"),
		q("risk", "As-tu tenu ton risque dans tes limites tout le mois ?", { kind: "yesno" }),
		q("change", "Que changeras-tu dans ta méthode le mois prochain ?", { carry: true }),
	],
	quarter: [
		q("grade", "Note ton trimestre", { kind: "scale" }),
		q("progress", "Où en es-tu de tes objectifs de l'année ?"),
		q("strategy", "Que faut-il changer dans ta stratégie ou ton risque ?"),
		q("goals", "Tes objectifs pour le prochain trimestre", { carry: true }),
	],
	year: [
		q("grade", "Note ton année", { kind: "scale" }),
		q("lessons", "Tes trois plus grandes leçons de l'année"),
		q("figures", "Quel chiffre a le plus progressé, et lequel s'est dégradé ?"),
		q("goals", "Tes objectifs pour l'année prochaine", { carry: true }),
	],
};

const es: Dict = {
	pre: [
		q("bias", "¿Cuál es tu sesgo hoy, y por qué?", { hint: "Tendencia de fondo, dónde está el precio respecto a los niveles clave" }),
		q("levels", "¿Qué niveles y qué setups esperas?"),
		q("max_loss", "Tu límite de pérdida y tu número máximo de trades hoy", { hint: "Por ejemplo: −2 R o 3 trades" }),
		q("focus", "Tu energía y tu concentración ahora mismo", { kind: "scale" }),
	],
	post: [
		q("grade", "Califica tu ejecución de hoy", { kind: "scale" }),
		q("rules", "¿Respetaste todas tus reglas?", { kind: "yesno" }),
		q("broken_rule", "¿Qué regla rompiste, y qué te llevó a hacerlo?", { showWhen: { id: "rules", value: "no" } }),
		q("well", "¿Qué hiciste bien?"),
		q("tomorrow", "¿Qué harás distinto mañana?", { carry: true }),
	],
	win: [
		q("thesis", "¿Por qué tomaste este trade?"),
		q("in_plan", "¿Era uno de tus setups, con todas las condiciones?", { kind: "yesno" }),
		q("exit", "¿Cómo saliste?", { kind: "choice", options: ["En mi objetivo", "Stop dinámico", "Demasiado pronto", "Demasiado tarde"] }),
		q("lesson", "¿Qué funcionó, y puedes repetirlo?"),
	],
	loss: [
		q("thesis", "¿Por qué tomaste este trade?"),
		q("in_plan", "¿Era uno de tus setups, con todas las condiciones?", { kind: "yesno" }),
		q("mistake", "¿Qué salió mal?", { kind: "choice", options: ["La entrada", "El stop", "El tamaño", "La salida", "Las emociones", "Nada: una pérdida normal"] }),
		q("respected_stop", "¿Respetaste tu stop?", { kind: "yesno" }),
		q("lesson", "¿Qué cambiarás la próxima vez?"),
	],
	even: [
		q("thesis", "¿Por qué tomaste este trade?"),
		q("be_planned", "¿Mover el stop a break-even era parte de tu plan?", { kind: "yesno" }),
		q("lesson", "¿Qué aprendes de él?"),
	],
	week: [
		q("grade", "Califica tu semana", { kind: "scale" }),
		q("best", "¿Qué funcionó mejor esta semana?"),
		q("worst", "¿Qué error te costó más?"),
		q("pattern", "¿Ves un patrón: un día, una hora, un setup, un estado de ánimo?"),
		q("focus", "Un solo foco para la próxima semana", { carry: true }),
	],
	month: [
		q("grade", "Califica tu mes", { kind: "scale" }),
		q("edge", "¿Qué setups sostuvieron el mes, y cuáles deberías dejar?"),
		q("risk", "¿Mantuviste tu riesgo dentro de tus límites todo el mes?", { kind: "yesno" }),
		q("change", "¿Qué cambiarás en tu proceso el próximo mes?", { carry: true }),
	],
	quarter: [
		q("grade", "Califica tu trimestre", { kind: "scale" }),
		q("progress", "¿A qué distancia estás de tus objetivos del año?"),
		q("strategy", "¿Qué debería cambiar en tu estrategia o tu riesgo?"),
		q("goals", "Tus objetivos para el próximo trimestre", { carry: true }),
	],
	year: [
		q("grade", "Califica tu año", { kind: "scale" }),
		q("lessons", "Tus tres mayores lecciones del año"),
		q("figures", "¿Qué cifra mejoró más, y cuál empeoró?"),
		q("goals", "Tus objetivos para el próximo año", { carry: true }),
	],
};

const pt: Dict = {
	pre: [
		q("bias", "Qual é o seu viés hoje, e por quê?", { hint: "Tendência de fundo, onde está o preço em relação aos níveis-chave" }),
		q("levels", "Quais níveis e quais setups você está esperando?"),
		q("max_loss", "Seu limite de perda e seu número máximo de trades hoje", { hint: "Por exemplo: −2 R ou 3 trades" }),
		q("focus", "Sua energia e sua concentração agora", { kind: "scale" }),
	],
	post: [
		q("grade", "Dê uma nota para a sua execução hoje", { kind: "scale" }),
		q("rules", "Você seguiu todas as suas regras?", { kind: "yesno" }),
		q("broken_rule", "Qual regra você quebrou, e o que levou você a isso?", { showWhen: { id: "rules", value: "no" } }),
		q("well", "O que você fez bem?"),
		q("tomorrow", "O que você vai fazer diferente amanhã?", { carry: true }),
	],
	win: [
		q("thesis", "Por que você entrou neste trade?"),
		q("in_plan", "Era um dos seus setups, com todas as condições?", { kind: "yesno" }),
		q("exit", "Como você saiu?", { kind: "choice", options: ["No meu alvo", "Stop móvel", "Cedo demais", "Tarde demais"] }),
		q("lesson", "O que funcionou, e você consegue repetir?"),
	],
	loss: [
		q("thesis", "Por que você entrou neste trade?"),
		q("in_plan", "Era um dos seus setups, com todas as condições?", { kind: "yesno" }),
		q("mistake", "O que deu errado?", { kind: "choice", options: ["A entrada", "O stop", "O tamanho", "A saída", "As emoções", "Nada: uma perda normal"] }),
		q("respected_stop", "Você respeitou o seu stop?", { kind: "yesno" }),
		q("lesson", "O que você vai mudar da próxima vez?"),
	],
	even: [
		q("thesis", "Por que você entrou neste trade?"),
		q("be_planned", "Levar o stop para o break-even fazia parte do seu plano?", { kind: "yesno" }),
		q("lesson", "O que você aprende com ele?"),
	],
	week: [
		q("grade", "Dê uma nota para a sua semana", { kind: "scale" }),
		q("best", "O que funcionou melhor esta semana?"),
		q("worst", "Qual erro custou mais caro?"),
		q("pattern", "Você vê um padrão: um dia, um horário, um setup, um estado de espírito?"),
		q("focus", "Um único foco para a próxima semana", { carry: true }),
	],
	month: [
		q("grade", "Dê uma nota para o seu mês", { kind: "scale" }),
		q("edge", "Quais setups sustentaram o mês, e quais você deveria abandonar?"),
		q("risk", "Você manteve o risco dentro dos seus limites o mês todo?", { kind: "yesno" }),
		q("change", "O que você vai mudar no seu processo no próximo mês?", { carry: true }),
	],
	quarter: [
		q("grade", "Dê uma nota para o seu trimestre", { kind: "scale" }),
		q("progress", "A que distância você está das suas metas do ano?"),
		q("strategy", "O que deveria mudar na sua estratégia ou no seu risco?"),
		q("goals", "Suas metas para o próximo trimestre", { carry: true }),
	],
	year: [
		q("grade", "Dê uma nota para o seu ano", { kind: "scale" }),
		q("lessons", "Suas três maiores lições do ano"),
		q("figures", "Qual número mais melhorou, e qual piorou?"),
		q("goals", "Suas metas para o próximo ano", { carry: true }),
	],
};

const DEFAULTS: Record<Lang, Dict> = { en, fr, es, pt };

/** The questions a set starts with, in a language; a fresh copy each time. */
export function defaultQuestions(id: TemplateId, lang: Lang): Question[] {
	return (DEFAULTS[lang] ?? en)[id].map((x) => ({ ...x, options: x.options ? [...x.options] : undefined, showWhen: x.showWhen ? { ...x.showWhen } : undefined }));
}
