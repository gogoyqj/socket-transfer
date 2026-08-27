// ============ Error Codes ============

export enum TransferErrorCode {
  /** 生产端断线超 5 分钟 */
  PRODUCER_DISCONNECTED = 10001,
  /** 订阅失败：鉴权失败或 uuid 不存在 */
  SUBSCRIBE_FAILED = 10002,
  /** 鉴权失败：uid/token 不合法 */
  AUTH_FAILED = 10003,
  /** 凭证变更：生产端重连时 token 变了 */
  CREDENTIALS_CHANGED = 10004,
  /** 消息过大 */
  MESSAGE_TOO_LARGE = 10005,
}

// ============ Client → Server Messages ============

export interface RegisterTransferMsg {
  type: "register_transfer";
  uid: string;
  token: string;
  uuid: string;
  name: string;
}

export interface ListTransferMsg {
  type: "list_transfer";
  uid: string;
  token: string;
  cuuid?: string;
}

export interface SubscribeTransferMsg {
  type: "subscribe_transfer";
  uid: string;
  token: string;
  uuid: string;
  cuuid: string;
}

export interface TransferProduceMsg {
  type: "transfer_produce";
  data: {
    uuid: string;
    targetConsumer?: string;  // cuuid: 有值则定向，无值则广播
    message: unknown;
  };
}

export interface TransferConsumeMsg {
  type: "transfer_consume";
  data: {
    uuid: string;
    cuuid: string;            // 服务端注入：消息来源的消费者标识
    message: unknown;
  };
}

export type ClientMessage =
  | RegisterTransferMsg
  | ListTransferMsg
  | SubscribeTransferMsg
  | TransferProduceMsg
  | TransferConsumeMsg;

// ============ Server → Client Messages ============

export interface TransferListMsg {
  type: "transfer_list";
  data: {
    list: Array<{ uuid: string; name: string }>;
  };
}

export interface TransferConnectMsg {
  type: "transfer_connect";
  data: {
    uuid: string;
  };
}

export interface TransferBreakMsg {
  type: "transfer_break";
  data: {
    code: TransferErrorCode;
  };
}

export interface TransferErrorMsg {
  type: "transfer_error";
  data: {
    code: TransferErrorCode;
    message: string;
  };
}

export type ServerMessage =
  | TransferListMsg
  | TransferConnectMsg
  | TransferBreakMsg
  | TransferErrorMsg;

// ============ Internal Types ============

export interface UserCredential {
  uid: string;
  token: string;
}

export interface ConnectionInfo {
  uuid: string;
  name: string;
  uid: string;
  token: string;
}

export interface TransferListItem {
  uuid: string;
  name: string;
}

// Forwarder: bridges consumer ↔ producer
export interface Forwarder {
  id: string;              // cuuid: 消费者唯一标识
  send(data: unknown): void;
  destroy(): void;
}

// Minimal WebSocket interface for testability
export interface SocketLike {
  send(data: unknown): void;
  close(): void;
  readyState: number;
  on(event: string, listener: (...args: unknown[]) => void): void;
  off(event: string, listener: (...args: unknown[]) => void): void;
}

// Constants
export const MAX_MESSAGE_SIZE = 1 * 1024 * 1024; // 1MB
export const RECONNECT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
export const TOKEN_LENGTH = 64;
