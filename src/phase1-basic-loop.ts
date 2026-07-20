import Anthropic from "@anthropic-ai/sdk";

// El cliente lee la API key de la variable de entorno ANTHROPIC_API_KEY.
// Nunca la escribas en el código.
const client = new Anthropic();

// ---------------------------------------------------------------------------
// PASO 1: Describimos la tool. Esto es solo un JSON que le mandamos al modelo.
// El modelo NUNCA ve el código de getCurrentTime() de abajo. Solo ve esto.
// ---------------------------------------------------------------------------
const tools: Anthropic.Tool[] = [
  {
    name: "get_current_time",
    description:
      "Devuelve la fecha y hora actual en formato ISO. Úsala siempre que el usuario pregunte por la hora o fecha de hoy.",
    input_schema: {
      type: "object",
      properties: {
        timezone: {
          type: "string",
          description: "Zona horaria IANA, ej. 'Europe/Madrid'. Opcional.",
        },
      },
      required: [],
    },
  },
];

// ---------------------------------------------------------------------------
// La implementación REAL de la tool. Esto es código normal y corriente,
// nada de IA. Aquí es donde vive la ejecución de verdad.
// ---------------------------------------------------------------------------
function getCurrentTime(input: { timezone?: string }): string {
  const now = new Date();
  if (input.timezone) {
    return now.toLocaleString("es-ES", { timeZone: input.timezone });
  }
  return now.toISOString();
}

// Un "registro" de tools: nombre -> función real. Esto es deliberadamente
// simple; en la Fase 4 lo haremos crecer para varias tools.
const toolImplementations: Record<string, (input: any) => string> = {
  get_current_time: getCurrentTime,
};

// ---------------------------------------------------------------------------
// PASO 2-4: el bucle del harness.
// ---------------------------------------------------------------------------
async function runAgent(userMessage: string) {
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userMessage },
  ];

  console.log(`\n👤 Usuario: ${userMessage}\n`);

  // Loop: puede haber varias idas y vueltas de tool_use antes de la respuesta final.
  while (true) {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      tools,
      messages,
    });

    // Guardamos la respuesta del modelo en el historial, tal cual vino.
    messages.push({ role: "assistant", content: response.content });

    // ¿El modelo pidió texto final, o quiere ejecutar una tool?
    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );

    if (toolUseBlocks.length === 0) {
      // No hay tool_use: es la respuesta final en lenguaje natural.
      const textBlock = response.content.find((b) => b.type === "text");
      if (textBlock && textBlock.type === "text") {
        console.log(`🤖 Claude: ${textBlock.text}\n`);
      }
      break;
    }

    // Hay una (o varias) llamadas a tool. Las ejecutamos de verdad, aquí,
    // en nuestro código — no en el modelo.
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of toolUseBlocks) {
      console.log(
        `🔧 El modelo pide ejecutar: ${block.name}(${JSON.stringify(block.input)})`
      );

      const impl = toolImplementations[block.name];
      let resultText: string;

      if (!impl) {
        // Guardarraíl mínimo: si el modelo inventa una tool que no existe,
        // no explotamos, se lo decimos y que se corrija.
        resultText = `Error: la tool '${block.name}' no existe.`;
      } else {
        try {
          resultText = impl(block.input);
        } catch (err) {
          resultText = `Error ejecutando la tool: ${(err as Error).message}`;
        }
      }

      console.log(`   ↳ resultado: ${resultText}`);

      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: resultText,
      });
    }

    // Le devolvemos los resultados al modelo como un nuevo mensaje "user"
    // (así es como lo espera la API: tool_result siempre va en un mensaje user).
    messages.push({ role: "user", content: toolResults });
    // El while(true) vuelve a llamar a la API con el historial actualizado.
  }
}

await runAgent("¿Qué hora es ahora mismo en Madrid?");
