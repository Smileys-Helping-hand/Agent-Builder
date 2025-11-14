declare module "react-speech-recognition" {
  export interface SpeechRecognitionHook {
    transcript: string;
    listening: boolean;
    resetTranscript: () => void;
    browserSupportsSpeechRecognition: boolean;
    isMicrophoneAvailable: boolean;
  }

  export function useSpeechRecognition(): SpeechRecognitionHook;
  export function startListening(options?: { continuous?: boolean; language?: string }): Promise<void>;
  export function stopListening(): void;
  const SpeechRecognition: {
    startListening: typeof startListening;
    stopListening: typeof stopListening;
    browserSupportsSpeechRecognition: () => boolean;
  };
  export default SpeechRecognition;
}

declare module "react-syntax-highlighter" {
  import { ComponentType } from "react";
  export interface SyntaxHighlighterProps {
    language?: string;
    style?: Record<string, unknown>;
    PreTag?: ComponentType<any> | string;
    className?: string;
    children?: string;
  }
  export const Prism: ComponentType<SyntaxHighlighterProps>;
}

declare module "react-syntax-highlighter/dist/cjs/styles/prism" {
  export const vscDarkPlus: Record<string, unknown>;
}

declare module "react-markdown" {
  import { ComponentType, ReactNode } from "react";
  export interface ReactMarkdownProps {
    children?: ReactNode;
    className?: string;
    remarkPlugins?: unknown[];
    rehypePlugins?: unknown[];
    linkTarget?: string | ((href: string, children: ReactNode) => string | undefined);
    components?: Record<string, ComponentType<any>>;
  }
  const ReactMarkdown: ComponentType<ReactMarkdownProps>;
  export default ReactMarkdown;
}

declare module "remark-gfm" {
  const plugin: any;
  export default plugin;
}

declare module "recharts" {
  export const ResponsiveContainer: any;
  export const ScatterChart: any;
  export const Scatter: any;
  export const XAxis: any;
  export const YAxis: any;
  export const Tooltip: any;
  export default any;
}
