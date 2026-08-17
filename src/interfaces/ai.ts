export interface ScheduleIntent {
    date: string;
    startHour: number;
    firstName: string;
    lastName: string;
    phone: string;
    notes?: string;
}

export interface AIResponse {
    content: string;
    scheduleIntent?: ScheduleIntent;
}

export interface ToolCallResult {
    name: string;
    content: string;
}