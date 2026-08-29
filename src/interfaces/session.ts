export interface SessionMonitorOptions {
    maxReconnectAttempts?: number;
    onDisconnected?: () => void;
    onReconnecting?: (attempt: number) => void;
    onReconnected?: () => void;
    onFailed?: () => void;
}
