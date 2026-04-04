import { useState, useCallback } from 'react';
import { AssistantMessage, Task } from '../../types';
import { aiService } from '../services/aiService';
import { searchIndexService } from '../services/searchIndexService';

export const useTaskAssistant = (allTasks: Task[]) => {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim()) return;

    const userMsg: AssistantMessage = {
      id: Date.now().toString(),
      role: 'user',
      content,
      timestamp: new Date(),
      status: 'done',
    };
    
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);

    try {
      // Phase 2: RAG Context Retrieval
      const rankedMatches = searchIndexService.searchRanked(content);
      const topTaskIds = rankedMatches.slice(0, 10).map(m => m.id);
      const relevantTasks = allTasks.filter(t => topTaskIds.includes(t.id));
      const contextString = searchIndexService.formatTasksForContext(relevantTasks);

      const systemPrompt = `You are the LiquiTask AI Assistant. You help users manage their workspace.
Below is the context of relevant tasks from the user's board:
---
${contextString}
---
Use this information to provide accurate and helpful responses. If the user asks about a specific task mentioned above, refer to it by its Job ID.`;

      // Basic text generation with context
      const response = await aiService.generateText(`${systemPrompt}\n\nUser: ${content}`);
      
      const assistantMsg: AssistantMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response || "I couldn't generate a response.",
        timestamp: new Date(),
        status: 'done',
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (error) {
      console.error('Assistant error:', error);
      const errorMsg: AssistantMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: "Sorry, I encountered an error while processing your request.",
        timestamp: new Date(),
        status: 'error',
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clearChat = useCallback(() => setMessages([]), []);

  return { messages, sendMessage, isLoading, clearChat };
};
