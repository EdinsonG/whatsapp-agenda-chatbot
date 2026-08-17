export type Intent = 'slots' | 'book' | 'list' | 'greeting' | 'unknown';

export interface ParsedCommand {
    intent: Intent;
    date?: string;
    startHour?: number;
    customerName?: string;
    lastName?: string;
    phone?: string;
    message?: string;
}