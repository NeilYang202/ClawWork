import { WebSocketServer, WebSocket } from 'ws';
import { PLUGIN_WS_PORT } from '@clawwork/shared';
import type { WsMessage, WsTextMessage, WsMediaMessage } from '@clawwork/shared';

// Active WebSocket connection to ClawWork Desktop App
let desktopConnection: WebSocket | null = null;
let wss: WebSocketServer | null = null;

function startWsServer(port: number, logger: { info: Function; error: Function }) {
  if (wss) return;

  wss = new WebSocketServer({ port });

  wss.on('connection', (ws) => {
    logger.info(`ClawWork Desktop connected`);
    desktopConnection = ws;

    ws.on('close', () => {
      logger.info(`ClawWork Desktop disconnected`);
      desktopConnection = null;
    });

    ws.on('error', (err) => {
      logger.error(`WebSocket error: ${err.message}`);
    });
  });

  logger.info(`ClawWork plugin WebSocket server listening on :${port}`);
}

function sendToDesktop(message: WsMessage): boolean {
  if (!desktopConnection || desktopConnection.readyState !== WebSocket.OPEN) {
    return false;
  }
  desktopConnection.send(JSON.stringify(message));
  return true;
}

/**
 * OpenClaw Plugin entry point.
 * Called by OpenClaw Gateway when loading this channel plugin.
 */
export default function register(api: any) {
  const logger = api.logger ?? console;

  // Start WebSocket server for Desktop App to connect to
  const port = api.config?.wsPort ?? PLUGIN_WS_PORT;
  startWsServer(port, logger);

  // Register the ClawWork channel
  api.registerChannel({
    id: 'clawwork',
    label: 'ClawWork Desktop',

    outbound: {
      /**
       * Called when the Agent sends a text message to the user.
       * Forwards it to ClawWork Desktop via WebSocket.
       */
      sendText: async (ctx: any) => {
        const msg: WsTextMessage = {
          type: 'text',
          sessionKey: ctx.sessionKey,
          content: ctx.text,
          messageId: ctx.messageId,
        };

        const sent = sendToDesktop(msg);
        if (!sent) {
          logger.error('ClawWork Desktop is not connected, message dropped');
        }

        return { delivered: sent };
      },

      /**
       * Called when the Agent sends a file/media to the user.
       * Sends the local file path to ClawWork Desktop for copying.
       */
      sendMedia: async (ctx: any) => {
        const msg: WsMediaMessage = {
          type: 'media',
          sessionKey: ctx.sessionKey,
          mediaPath: ctx.mediaPath,
          mediaType: ctx.mediaType ?? 'file',
          fileName: ctx.fileName,
        };

        const sent = sendToDesktop(msg);
        if (!sent) {
          logger.error('ClawWork Desktop is not connected, media dropped');
        }

        return { delivered: sent };
      },
    },

    status: {
      /**
       * Called periodically by Gateway to check if the Desktop App is connected.
       */
      check: async () => ({
        connected: desktopConnection?.readyState === WebSocket.OPEN,
      }),
    },
  });

  logger.info('ClawWork channel plugin registered');
}
