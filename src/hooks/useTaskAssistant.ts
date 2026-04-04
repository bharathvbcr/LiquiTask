import { useState, useCallback } from 'react';
import { AssistantMessage, Task, AIContext } from '../../types';
import { aiService } from '../services/aiService';

interface UseTaskAssistantProps {
  context: AIContext;
  allTasks: Task[];
  addTask: (task: Partial<Task>) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  searchTasks: (query: string) => string[];
}

export const useTaskAssistant = ({
  context,
  allTasks,
  addTask,
  updateTask,
  searchTasks,
}: UseTaskAssistantProps) => {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [activeTool, setActiveTool] = useState<string | null>(null);

  const executeTool = async (toolCall: any): Promise<any> => {
    const { name, args } = toolCall;
    setActiveTool(name);
    
    try {
      switch (name) {
        case 'create_task':
          addTask(args);
          return { success: true, message: `Created task: ${args.title}` };
        
        case 'update_task':
          updateTask(args.id, args);
          return { success: true, message: `Updated task: ${args.id}` };
        
        case 'search_tasks':
          return { tasks: searchTasks(args.query) };
        
        case 'search_workspace':
          setIsSearching(true);
          const files = await window.electronAPI?.workspace.searchFiles(args.query);
          setIsSearching(false);
          return { files: files ?? [] };

        case 'read_workspace_file':
          const content = await window.electronAPI?.workspace.readFile(args.path);
          return { content: content ?? '' };

        case 'write_workspace_file':
          await window.electronAPI?.workspace.writeFile(args.path, args.content);
          return { success: true };
        
        default:
          return { error: `Tool ${name} not found` };
      }
    } catch (error: any) {
      console.error(`Tool execution error (${name}):`, error);
      return { error: error.message };
    } finally {
      setActiveTool(null);
    }
  };

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim()) return;

    const userMsg: AssistantMessage = {
      id: Date.now().toString(),
      role: 'user',
      content,
      timestamp: new Date(),
      status: 'done',
    };
    
    let currentConversation = [...messages, userMsg];
    setMessages(currentConversation);
    setIsLoading(true);

    try {
      let turn = 0;
      const MAX_TURNS = 5;
      let finalContent = "";
      
      while (turn < MAX_TURNS) {
        // Show RAG context indicator on the first turn (user message triggers context retrieval)
        if (turn === 0) setIsSearching(true);
        const response = await aiService.generateAgentResponse(currentConversation, context, allTasks);
        if (turn === 0) setIsSearching(false);
        
        // If there are tool calls, we need another turn
        if (response.toolCalls && response.toolCalls.length > 0) {
          // 1. Add assistant msg with tool calls to history
          const assistantToolMsg: AssistantMessage = {
            id: `asst-${Date.now()}-${turn}`,
            role: 'assistant',
            content: response.content || "",
            timestamp: new Date(),
            status: 'done',
            toolCalls: response.toolCalls,
          };
          currentConversation = [...currentConversation, assistantToolMsg];
          setMessages(currentConversation);

          // 2. Execute tools
          const toolResults = await Promise.all(response.toolCalls.map(executeTool));
          
          // 3. Add function results to history
          const functionMsg: AssistantMessage = {
            id: `func-${Date.now()}-${turn}`,
            role: 'function',
            content: "Tool execution completed.",
            timestamp: new Date(),
            status: 'done',
            toolResults: response.toolCalls.map((tc, i) => ({
              name: tc.name,
              result: toolResults[i],
            })),
          };
          currentConversation = [...currentConversation, functionMsg];
          setMessages(currentConversation);

          turn++;
          // If no content but tools, we continue the loop
          if (response.content) finalContent = response.content;
        } else {
          // No more tool calls, we are done
          finalContent = response.content;
          
          const finalMsg: AssistantMessage = {
            id: `final-${Date.now()}`,
            role: 'assistant',
            content: finalContent || "I've completed the requested actions.",
            timestamp: new Date(),
            status: 'done',
          };
          setMessages(prev => [...prev, finalMsg]);
          break;
        }
      }

      if (turn >= MAX_TURNS) {
        console.warn("Reached max tool turns");
      }
    } catch (error) {
      console.error('Assistant error:', error);
      const errorMsg: AssistantMessage = {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: "Sorry, I encountered an error while processing your request.",
        timestamp: new Date(),
        status: 'error',
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  }, [messages, context, allTasks, addTask, updateTask, searchTasks]);

  const clearChat = useCallback(() => setMessages([]), []);

  return { messages, sendMessage, isLoading, isSearching, activeTool, clearChat };
};
