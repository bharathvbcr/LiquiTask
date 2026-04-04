import { useState, useCallback } from 'react';
import { AssistantMessage } from '../../types';
import { aiService } from '../services/aiService';

export const useTaskAssistant = () => {
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
      // Basic text generation for Phase 1
      const response = await aiService.generateText(content);
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
