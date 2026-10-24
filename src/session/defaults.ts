import type { Gate } from "./gate";

// What session mode starts with, in the four languages of Tradoshi: a checklist, the
// tags of the session log and a first trade gate. All of it is the trader's to change.

export type Lang = "en" | "fr" | "es" | "pt";

interface Starter {
	checklist: string[];
	tags: string[];
	/** The tag whose notes come back in the review. */
	lesson: string;
	gateName: string;
	limit: string;
	setup: string;
	risk: string;
	context: string;
	mood: string;
	yes: string;
	no: string;
	calm: string;
	tired: string;
	upset: string;
	limitNote: string;
	setupNote: string;
	riskNote: string;
	contextNote: string;
	tiredNote: string;
	upsetNote: string;
}

const STARTERS: Record<Lang, Starter> = {
	en: {
		checklist: ["Economic calendar checked", "Key levels marked on the chart", "Today's plan written", "Loss limit set", "Phone away, notifications off"],
		tags: ["Analysis", "Market", "Execution", "Psychology", "Lesson"],
		lesson: "Lesson",
		gateName: "Before each trade",
		limit: "Have you reached your loss limit or your number of trades for today?",
		setup: "Is it one of your setups, with every condition met?",
		risk: "Are the stop and the size set before you enter?",
		context: "Is the context clean: no major news within 15 minutes, a normal spread?",
		mood: "How do you feel right now?",
		yes: "Yes",
		no: "No",
		calm: "Calm and focused",
		tired: "Tired or distracted",
		upset: "Upset by a previous trade",
		limitNote: "Your day is done. Close the platform and write your review.",
		setupNote: "Not in your plan: let this one go.",
		riskNote: "Place the stop and work out the size first.",
		contextNote: "Wait until the news is out and the spread is back to normal.",
		tiredNote: "Step away from the screen for five minutes, then run the gate again.",
		upsetNote: "This is how revenge trades start. No trade until your next session.",
	},
	fr: {
		checklist: ["Calendrier économique vérifié", "Niveaux clés tracés sur le graphique", "Plan du jour écrit", "Limite de perte fixée", "Téléphone rangé, notifications coupées"],
		tags: ["Analyse", "Marché", "Exécution", "Psychologie", "Leçon"],
		lesson: "Leçon",
		gateName: "Avant chaque trade",
		limit: "As-tu atteint ta limite de perte ou ton nombre de trades du jour ?",
		setup: "Est-ce un de tes setups, toutes conditions réunies ?",
		risk: "Le stop et la taille sont-ils fixés avant d'entrer ?",
		context: "Le contexte est-il propre : pas d'annonce majeure dans les 15 minutes, un spread normal ?",
		mood: "Comment te sens-tu en ce moment ?",
		yes: "Oui",
		no: "Non",
		calm: "Calme et concentré",
		tired: "Fatigué ou distrait",
		upset: "Contrarié par un trade précédent",
		limitNote: "Ta journée est finie. Ferme la plateforme et fais ta revue.",
		setupNote: "Hors de ton plan : laisse passer celui-là.",
		riskNote: "Place le stop et calcule la taille d'abord.",
		contextNote: "Attends que l'annonce soit passée et que le spread redevienne normal.",
		tiredNote: "Éloigne-toi de l'écran cinq minutes, puis repasse la porte.",
		upsetNote: "C'est ainsi que commencent les trades de vengeance. Plus de trade avant ta prochaine séance.",
	},
	es: {
		checklist: ["Calendario económico revisado", "Niveles clave marcados en el gráfico", "Plan del día escrito", "Límite de pérdida fijado", "Teléfono guardado, notificaciones apagadas"],
		tags: ["Análisis", "Mercado", "Ejecución", "Psicología", "Lección"],
		lesson: "Lección",
		gateName: "Antes de cada trade",
		limit: "¿Has llegado a tu límite de pérdida o a tu número de trades de hoy?",
		setup: "¿Es uno de tus setups, con todas las condiciones?",
		risk: "¿El stop y el tamaño están fijados antes de entrar?",
		context: "¿El contexto está limpio: ninguna noticia importante en 15 minutos, un spread normal?",
		mood: "¿Cómo te sientes ahora mismo?",
		yes: "Sí",
		no: "No",
		calm: "Tranquilo y concentrado",
		tired: "Cansado o distraído",
		upset: "Molesto por un trade anterior",
		limitNote: "Tu día terminó. Cierra la plataforma y haz tu revisión.",
		setupNote: "Fuera de tu plan: deja pasar este.",
		riskNote: "Coloca el stop y calcula el tamaño primero.",
		contextNote: "Espera a que pase la noticia y el spread vuelva a la normalidad.",
		tiredNote: "Aléjate de la pantalla cinco minutos y vuelve a pasar la puerta.",
		upsetNote: "Así empiezan los trades de venganza. Ningún trade hasta tu próxima sesión.",
	},
	pt: {
		checklist: ["Calendário econômico conferido", "Níveis-chave marcados no gráfico", "Plano do dia escrito", "Limite de perda definido", "Celular guardado, notificações desligadas"],
		tags: ["Análise", "Mercado", "Execução", "Psicologia", "Lição"],
		lesson: "Lição",
		gateName: "Antes de cada trade",
		limit: "Você atingiu seu limite de perda ou seu número de trades de hoje?",
		setup: "É um dos seus setups, com todas as condições?",
		risk: "O stop e o tamanho estão definidos antes de entrar?",
		context: "O contexto está limpo: nenhuma notícia importante nos próximos 15 minutos, spread normal?",
		mood: "Como você está se sentindo agora?",
		yes: "Sim",
		no: "Não",
		calm: "Calmo e concentrado",
		tired: "Cansado ou distraído",
		upset: "Incomodado com um trade anterior",
		limitNote: "Seu dia acabou. Feche a plataforma e faça sua revisão.",
		setupNote: "Fora do seu plano: deixe este passar.",
		riskNote: "Coloque o stop e calcule o tamanho primeiro.",
		contextNote: "Espere a notícia sair e o spread voltar ao normal.",
		tiredNote: "Afaste-se da tela por cinco minutos e passe pela porta de novo.",
		upsetNote: "É assim que começam os trades de vingança. Nenhum trade até a sua próxima sessão.",
	},
};

const starter = (lang: Lang): Starter => STARTERS[lang] ?? STARTERS.en;

export function defaultChecklist(lang: Lang): string[] {
	return [...starter(lang).checklist];
}

export function defaultLogTags(lang: Lang): string[] {
	return [...starter(lang).tags];
}

/** The tag of the notes that come back in the review, in a language. */
export function defaultLessonTag(lang: Lang): string {
	return starter(lang).lesson;
}

/** The first trade gate: five quick questions, each answer ending in a decision or the next question. */
export function starterGate(lang: Lang, id = "gate-1"): Gate {
	const s = starter(lang);
	return {
		id,
		name: s.gateName,
		start: "limit",
		nodes: [
			{
				id: "limit",
				question: s.limit,
				options: [
					{ label: s.yes, to: { outcome: "nogo", note: s.limitNote } },
					{ label: s.no, to: { node: "setup" } },
				],
			},
			{
				id: "setup",
				question: s.setup,
				options: [
					{ label: s.yes, to: { node: "risk" } },
					{ label: s.no, to: { outcome: "nogo", note: s.setupNote } },
				],
			},
			{
				id: "risk",
				question: s.risk,
				options: [
					{ label: s.yes, to: { node: "context" } },
					{ label: s.no, to: { outcome: "wait", note: s.riskNote } },
				],
			},
			{
				id: "context",
				question: s.context,
				options: [
					{ label: s.yes, to: { node: "mood" } },
					{ label: s.no, to: { outcome: "wait", note: s.contextNote } },
				],
			},
			{
				id: "mood",
				question: s.mood,
				options: [
					{ label: s.calm, to: { outcome: "go" } },
					{ label: s.tired, to: { outcome: "wait", note: s.tiredNote } },
					{ label: s.upset, to: { outcome: "nogo", note: s.upsetNote } },
				],
			},
		],
	};
}
