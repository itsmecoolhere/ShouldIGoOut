import { isSameDay } from "date-fns";

export interface Event {
    id: string;
    title: string;
    time: Date;
    location: string;
    lat?: number;
    lon?: number;
    isMandatory: boolean;
}

const STORAGE_KEY = "user_schedule";

export const getStoredSchedule = (): Event[] => {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    try {
        const raw = JSON.parse(data);
        return raw.map((e: any) => ({ ...e, time: new Date(e.time) }));
    } catch (err) {
        console.error("Failed to parse schedule", err);
        return [];
    }
};

export const saveSchedule = (events: Event[]) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
};



export const addEvent = (events: Event[], newEvent: Omit<Event, "id">): Event[] => {
    const event = { ...newEvent, id: Math.random().toString(36).substr(2, 9) };
    const updated = [...events, event];
    saveSchedule(updated);
    return updated;
};

export const addEventsBulk = (currentEvents: Event[], newEvents: Omit<Event, "id">[]): Event[] => {
    const eventsToAdd = newEvents.map(e => ({ ...e, id: Math.random().toString(36).substr(2, 9) }));
    const updated = [...currentEvents, ...eventsToAdd];
    saveSchedule(updated);
    return updated;
};

export const removeEvent = (events: Event[], id: string): Event[] => {
    const updated = events.filter(e => e.id !== id);
    saveSchedule(updated);
    return updated;
};

export const clearSchedule = (): Event[] => {
    localStorage.removeItem(STORAGE_KEY);
    return [];
};

export const clearEventsForDay = (events: Event[], day: Date): Event[] => {
    const updated = events.filter(e => !isSameDay(e.time, day));
    saveSchedule(updated);
    return updated;
};
