// Enhanced natural language parsing for quick task entry

export interface ParsedTask {
    title: string;
    priority?: string;
    dueDate?: Date;
    projectName?: string;
    timeEstimate?: number; // in minutes
    tags: string[];
}

export function parseQuickTask(input: string): ParsedTask {
    let title = input;
    let priority: string | undefined;
    let dueDate: Date | undefined;
    let projectName: string | undefined;
    let timeEstimate: number | undefined;
    const tags: string[] = [];

    // Parse priority markers (!h, !m, !l, !high, !medium, !low)
    if (input.match(/!(high|h)\b/i)) {
        priority = 'high';
        title = title.replace(/!(high|h)\b/gi, '');
    } else if (input.match(/!(medium|m)\b/i)) {
        priority = 'medium';
        title = title.replace(/!(medium|m)\b/gi, '');
    } else if (input.match(/!(low|l)\b/i)) {
        priority = 'low';
        title = title.replace(/!(low|l)\b/gi, '');
    }

    // Parse project (#projectname)
    const projectMatch = input.match(/#([a-zA-Z0-9_-]+)/);
    if (projectMatch) {
        projectName = projectMatch[1];
        title = title.replace(projectMatch[0], '');
    }

    // Parse time estimate (~2h, ~30m, ~1.5h)
    const timeMatch = input.match(/~(\d+(?:\.\d+)?)(h|m)/i);
    if (timeMatch) {
        const value = parseFloat(timeMatch[1]);
        const unit = timeMatch[2].toLowerCase();
        timeEstimate = unit === 'h' ? value * 60 : value; // Convert to minutes
        title = title.replace(timeMatch[0], '');
    }

    // Parse tags (+tag)
    const tagMatches = input.matchAll(/\+([a-zA-Z0-9_-]+)/g);
    for (const match of tagMatches) {
        tags.push(match[1]);
        title = title.replace(match[0], '');
    }

    // Parse due date patterns (@today, @tomorrow, @nextweek, @MM/DD)
    const today = new Date();
    const todayMatch = input.match(/(@today|@tod)\b/i);
    const tomorrowMatch = input.match(/(@tomorrow|@tom)\b/i);
    const nextWeekMatch = input.match(/@next\s*week/i);
    const dateMatch = input.match(/@(\d{1,2})\/(\d{1,2})/); // @MM/DD format

    if (todayMatch) {
        dueDate = today;
        title = title.replace(todayMatch[0], '');
    } else if (tomorrowMatch) {
        dueDate = new Date(today);
        dueDate.setDate(today.getDate() + 1);
        title = title.replace(tomorrowMatch[0], '');
    } else if (nextWeekMatch) {
        dueDate = new Date(today);
        dueDate.setDate(today.getDate() + 7);
        title = title.replace(nextWeekMatch[0], '');
    } else if (dateMatch) {
        const month = parseInt(dateMatch[1]) - 1;
        const day = parseInt(dateMatch[2]);
        dueDate = new Date(today.getFullYear(), month, day);
        if (dueDate < today) {
            dueDate.setFullYear(today.getFullYear() + 1);
        }
        title = title.replace(dateMatch[0], '');
    }

    // Clean up any extra whitespace
    title = title.replace(/\s+/g, ' ').trim();

    return { title, priority, dueDate, projectName, timeEstimate, tags };
}
