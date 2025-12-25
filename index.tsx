
/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Type} from '@google/genai';
import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {createBlob, decode, decodeAudioData} from './utils';
import './visual-3d';

@customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  @state() isRecording = false;
  @state() status = 'Listo para charlar';
  @state() error = '';
  @state() memory: string[] = [];
  @state() showMemory = false;

  private client: GoogleGenAI;
  private sessionPromise: Promise<any>;
  private inputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 16000});
  private outputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 24000});
  @state() inputNode = this.inputAudioContext.createGain();
  @state() outputNode = this.outputAudioContext.createGain();
  private nextStartTime = 0;
  private mediaStream: MediaStream;
  private sourceNode: AudioBufferSourceNode;
  private scriptProcessorNode: ScriptProcessorNode;
  private sources = new Set<AudioBufferSourceNode>();

  static styles = css`
    :host {
      display: block;
      width: 100vw;
      height: 100vh;
      background: #0a0a0f;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      overflow: hidden;
    }

    #status {
      position: absolute;
      top: 8vh;
      left: 0;
      right: 0;
      z-index: 10;
      text-align: center;
      color: #fff;
      font-size: 1.4rem;
      font-weight: 300;
      text-shadow: 0 2px 10px rgba(0,0,0,0.5);
      pointer-events: none;
      padding: 0 20px;
    }

    .controls {
      z-index: 10;
      position: absolute;
      bottom: 6vh;
      left: 0;
      right: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 20px;
    }

    .btn-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
    }

    .btn-label {
      color: rgba(255, 255, 255, 0.7);
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    button {
      outline: none;
      border: 2px solid rgba(255, 255, 255, 0.2);
      color: white;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.08);
      width: 70px;
      height: 70px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      backdrop-filter: blur(8px);
    }

    button:hover:not([disabled]) {
      background: rgba(255, 255, 255, 0.15);
      transform: translateY(-3px);
      border-color: rgba(255, 255, 255, 0.5);
    }

    button[disabled] {
      opacity: 0.3;
      cursor: not-allowed;
    }

    #startButton {
      background: rgba(220, 38, 38, 0.2);
      border-color: rgba(220, 38, 38, 0.4);
      width: 90px;
      height: 90px;
    }

    #startButton.recording {
      animation: pulse-red 2s infinite;
      background: rgba(220, 38, 38, 0.5);
    }

    @keyframes pulse-red {
      0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.4); }
      70% { transform: scale(1.05); box-shadow: 0 0 0 15px rgba(220, 38, 38, 0); }
      100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(220, 38, 38, 0); }
    }

    #memoryToggle {
      position: absolute;
      top: 3vh;
      right: 3vw;
      z-index: 20;
      width: 60px;
      height: 60px;
      background: rgba(255, 215, 0, 0.15);
      border-color: rgba(255, 215, 0, 0.3);
    }

    .memory-panel {
      position: absolute;
      top: 0;
      right: 0;
      width: 320px;
      height: 100vh;
      background: #fdf6e3;
      color: #5c4b37;
      z-index: 30;
      transform: translateX(100%);
      transition: transform 0.4s ease;
      box-shadow: -10px 0 30px rgba(0,0,0,0.5);
      padding: 40px 25px;
      display: flex;
      flex-direction: column;
      border-left: 5px solid #d4af37;
    }

    .memory-panel.open {
      transform: translateX(0);
    }

    .memory-header {
      font-family: 'Georgia', serif;
      font-size: 1.8rem;
      border-bottom: 2px solid #d4af37;
      margin-bottom: 20px;
      padding-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .memory-list {
      flex: 1;
      overflow-y: auto;
      list-style: none;
      padding: 0;
    }

    .memory-item {
      padding: 12px 0;
      border-bottom: 1px dashed rgba(92, 75, 55, 0.2);
      font-size: 1rem;
      line-height: 1.4;
      animation: fadeIn 0.5s ease;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .close-memory {
      margin-top: 20px;
      background: #5c4b37;
      color: #fdf6e3;
      border: none;
      border-radius: 8px;
      padding: 12px;
      width: 100%;
      font-weight: bold;
      cursor: pointer;
      height: auto;
    }

    svg {
      width: 32px;
      height: 32px;
    }
  `;

  constructor() {
    super();
    this.initClient();
  }

  private async initClient() {
    this.nextStartTime = this.outputAudioContext.currentTime;
    this.client = new GoogleGenAI({
      apiKey: process.env.API_KEY,
    });
    this.outputNode.connect(this.outputAudioContext.destination);
    this.initSession();
  }

  private initSession() {
    const model = 'gemini-2.5-flash-native-audio-preview-09-2025';

    const recordarDatoPaciente: FunctionDeclaration = {
      name: 'recordarDatoPaciente',
      parameters: {
        type: Type.OBJECT,
        description: 'Guarda un dato importante sobre el paciente para recordarlo en el futuro (ej: nombres, gustos, salud).',
        properties: {
          dato: {
            type: Type.STRING,
            description: 'El dato específico que el paciente mencionó.',
          },
          categoria: {
            type: Type.STRING,
            description: 'Categoría del dato: Familia, Salud, Gustos, Pasado, etc.',
          }
        },
        required: ['dato'],
      },
    };

    this.sessionPromise = this.client.live.connect({
      model: model,
      callbacks: {
        onopen: () => {
          this.updateStatus('¡Hola! Soy tu compañero. Estoy aquí para escucharte.');
        },
        onmessage: async (message: LiveServerMessage) => {
          // Handle Tool Calls (Memory)
          if (message.toolCall) {
            for (const fc of message.toolCall.functionCalls) {
              if (fc.name === 'recordarDatoPaciente') {
                const newFact = `${(fc.args as any).categoria || 'Recuerdo'}: ${(fc.args as any).dato}`;
                this.memory = [...this.memory, newFact];
                
                // Responder a la IA para que sepa que se guardó
                this.sessionPromise.then(s => s.sendToolResponse({
                  functionResponses: {
                    id: fc.id,
                    name: fc.name,
                    response: { status: 'Dato guardado con cariño en mi memoria.' }
                  }
                }));
              }
            }
          }

          const audio = message.serverContent?.modelTurn?.parts[0]?.inlineData;
          if (audio) {
            this.nextStartTime = Math.max(this.nextStartTime, this.outputAudioContext.currentTime);
            const audioBuffer = await decodeAudioData(decode(audio.data), this.outputAudioContext, 24000, 1);
            const source = this.outputAudioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(this.outputNode);
            source.addEventListener('ended', () => this.sources.delete(source));
            source.start(this.nextStartTime);
            this.nextStartTime += audioBuffer.duration;
            this.sources.add(source);
          }

          if (message.serverContent?.interrupted) {
            this.sources.forEach(s => s.stop());
            this.sources.clear();
            this.nextStartTime = 0;
          }
        },
        onerror: () => this.updateError('Perdona, me distraje un segundo. ¿Me repites?'),
        onclose: () => this.updateStatus('Sesión terminada.'),
      },
      config: {
        responseModalities: [Modality.AUDIO],
        tools: [{functionDeclarations: [recordarDatoPaciente]}],
        speechConfig: {
          voiceConfig: {prebuiltVoiceConfig: {voiceName: 'Zephyr'}},
        },
        systemInstruction: `ERES: Un compañero entrañable para una persona de la tercera edad.
          MISIÓN: Combatir la soledad, entretener y RECORDAR.
          
          MEMORIA ACTIVA:
          - Es CRUCIAL que uses la herramienta 'recordarDatoPaciente' cada vez que el paciente diga algo personal.
          - Si menciona el nombre de un familiar, su comida favorita, una medicina que debe tomar, o un lugar donde vivió, ¡GUÁRDALO!
          - Usa estos datos guardados para personalizar la charla. Ej: "Me contaste que te gusta el arroz con leche, ¿tu mamá te lo preparaba así?"
          
          ESTILO DE CHARLA:
          1. EXTENSO Y CÁLIDO: Nunca respondas con frases cortas. Cuenta historias, haz analogías, sé muy conversacional.
          2. EMPATÍA RADICAL: Valida cada emoción. "Entiendo que te sientas así, es muy valiente de tu parte compartirlo".
          3. PREGUNTADOR: Termina siempre con una pregunta que invite a seguir charlando.
          4. NO MISTERIOSO: Eres transparente, amable y paciente. Si repiten la misma historia, escúchala con el mismo interés que la primera vez.`,
      },
    });
  }

  private updateStatus(msg: string) { this.status = msg; }
  private updateError(msg: string) { this.error = msg; }

  private async startRecording() {
    if (this.isRecording) return;
    this.inputAudioContext.resume();
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.sourceNode = this.inputAudioContext.createMediaStreamSource(this.mediaStream);
      this.sourceNode.connect(this.inputNode);
      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(4096, 1, 1);
      this.scriptProcessorNode.onaudioprocess = (e) => {
        if (!this.isRecording) return;
        this.sessionPromise.then(s => s.sendRealtimeInput({ media: createBlob(e.inputBuffer.getChannelData(0)) }));
      };
      this.sourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);
      this.isRecording = true;
      this.updateStatus('Te escucho con atención...');
    } catch (err) {
      this.updateStatus('Necesito permiso para el micrófono para poder charlar contigo.');
    }
  }

  private stopRecording() {
    this.isRecording = false;
    this.updateStatus('Aquí estaré cuando quieras seguir hablando.');
    if (this.scriptProcessorNode) this.scriptProcessorNode.disconnect();
    if (this.sourceNode) this.sourceNode.disconnect();
    if (this.mediaStream) this.mediaStream.getTracks().forEach(t => t.stop());
  }

  private reset() {
    this.sessionPromise?.then(s => s.close());
    this.initSession();
    this.updateStatus('¡Listo para una nueva charla!');
  }

  render() {
    return html`
      <div>
        <button id="memoryToggle" title="Recuerdos" @click=${() => this.showMemory = true}>
          <svg viewBox="0 0 24 24" fill="gold">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
          </svg>
        </button>

        <div class="memory-panel ${this.showMemory ? 'open' : ''}">
          <div class="memory-header">
            <svg viewBox="0 0 24 24" fill="#5c4b37" style="width:24px; height:24px;">
              <path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"/>
            </svg>
            Mi Libreta
          </div>
          <ul class="memory-list">
            ${this.memory.length === 0 
              ? html`<p style="font-style: italic; opacity: 0.6;">Aún no he anotado nada, ¡cuéntame algo sobre ti!</p>`
              : this.memory.map(m => html`<li class="memory-item">${m}</li>`)
            }
          </ul>
          <button class="close-memory" @click=${() => this.showMemory = false}>Guardar libreta</button>
        </div>

        <div id="status">
          ${this.status}
          <div style="font-size: 0.9rem; margin-top: 5px; opacity: 0.7; color: #ff8888;">${this.error}</div>
        </div>

        <gdm-live-audio-visuals-3d
          .inputNode=${this.inputNode}
          .outputNode=${this.outputNode}></gdm-live-audio-visuals-3d>

        <div class="controls">
          <div class="btn-container">
            <button id="resetButton" title="Reiniciar" @click=${this.reset} ?disabled=${this.isRecording}>
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
            </button>
            <span class="btn-label">Nuevo</span>
          </div>

          <div class="btn-container">
            <button id="startButton" class="${this.isRecording ? 'recording' : ''}" @click=${this.startRecording} ?disabled=${this.isRecording}>
              <svg viewBox="0 0 24 24" fill="white"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
            </button>
            <span class="btn-label">${this.isRecording ? 'Escuchando' : 'Hablar'}</span>
          </div>

          <div class="btn-container">
            <button id="stopButton" @click=${this.stopRecording} ?disabled=${!this.isRecording}>
              <svg viewBox="0 0 24 24" fill="white"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
            </button>
            <span class="btn-label">Pausar</span>
          </div>
        </div>
      </div>
    `;
  }
}
