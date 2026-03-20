import { describe, it, expect, vi, beforeEach } from 'vitest';
import { aiService } from '../aiService';
import storageService from '../storageService';
import { AIConfig, AIContext } from '../../../types';

// Mock storageService
vi.mock('../storageService', () => ({
  default: {
    get: vi.fn(),
    set: vi.fn(),
  },
  storageService: {
    get: vi.fn(),
    set: vi.fn(),
  }
}));

// Mock @google/generative-ai
const mockGenerateContent = vi.fn().mockResolvedValue({
  response: {
    text: () => JSON.stringify([{ title: 'Test Task', summary: 'Test Summary', priority: 'high', tags: ['ai'], timeEstimate: 30 }])
  }
});

const mockGetGenerativeModel = vi.fn().mockReturnValue({
  generateContent: mockGenerateContent
});

vi.mock('@google/generative-ai', () => {
  class GoogleGenerativeAI {
    getGenerativeModel = mockGetGenerativeModel;
  }

  return {
    GoogleGenerativeAI,
    SchemaType: {
        OBJECT: 'OBJECT',
        STRING: 'STRING',
        ARRAY: 'ARRAY',
        NUMBER: 'NUMBER'
    }
  };
});

// Mock fetch for Ollama
global.fetch = vi.fn();

describe('AiService', () => {
  const mockContext: AIContext = {
    activeProjectId: 'p1',
    projects: [{ id: 'p1', name: 'Project 1', type: 'default' }],
    priorities: [
      { id: 'high', label: 'High', color: 'red', level: 1 },
      { id: 'medium', label: 'Medium', color: 'yellow', level: 2 }
    ]
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('extractTasksFromText', () => {
    it('throws error if provider is not configured', async () => {
      (storageService.get as any).mockReturnValue(null);
      await expect(aiService.extractTasksFromText('test', mockContext)).rejects.toThrow('AI provider is not configured');
    });

    it('extracts tasks using Gemini provider', async () => {
      const config: AIConfig = { provider: 'gemini', geminiApiKey: 'test-key', geminiModel: 'gemini-3.1-flash-lite' };
      (storageService.get as any).mockReturnValue(config);

      mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () => JSON.stringify([{ title: 'Test Task', summary: 'Test Summary', priority: 'high', tags: ['ai'], timeEstimate: 30 }])
        }
      });

      const tasks = await aiService.extractTasksFromText('Extract some tasks', mockContext);
      
      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe('Test Task');
      expect(tasks[0].priority).toBe('high');
    });

    it('extracts tasks using Ollama provider', async () => {
      const config: AIConfig = { provider: 'ollama', ollamaModel: 'llama3' };
      (storageService.get as any).mockReturnValue(config);

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          message: {
            content: JSON.stringify([{ reasoning: 'Analysis...', title: 'Ollama Task', summary: 'Local AI', priority: 'medium', tags: [], timeEstimate: 10 }])
          }
        })
      });

      const tasks = await aiService.extractTasksFromText('Extract tasks local', mockContext);
      
      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe('Ollama Task');
      expect(tasks[0].priority).toBe('medium');
    });

    it('sends Ollama generation requests without a client timeout signal', async () => {
      const config: AIConfig = { provider: 'ollama', ollamaModel: 'llama3' };
      (storageService.get as any).mockReturnValue(config);

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          message: {
            content: JSON.stringify([{ reasoning: 'Analysis...', title: 'Ollama Task', summary: 'Local AI', priority: 'medium', tags: [], timeEstimate: 10 }])
          }
        })
      });

      await aiService.extractTasksFromText('test', mockContext);

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/chat',
        expect.not.objectContaining({ signal: expect.anything() })
      );
    });

    it('reports Ollama server unreachable during extraction', async () => {
      const config: AIConfig = { provider: 'ollama', ollamaBaseUrl: 'http://invalid:11434', ollamaModel: 'llama3' };
      (storageService.get as any).mockReturnValue(config);

      (global.fetch as any).mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(aiService.extractTasksFromText('test', mockContext)).rejects.toThrow(
        'Ollama server unreachable at http://invalid:11434'
      );
    });
  });

  describe('testProviderConnection', () => {
      it('successfully tests Gemini connection', async () => {
          const config: AIConfig = { provider: 'gemini', geminiApiKey: 'test-key', geminiModel: 'gemini-3.1-flash-lite' };
          (storageService.get as any).mockReturnValue(config);

          mockGenerateContent.mockResolvedValueOnce({
              response: { text: () => 'ok' }
          });

          const result = await aiService.testProviderConnection();
          expect(result.ok).toBe(true);
          expect(result.message).toContain('Connected to Gemini');
      });

      it('returns config error when Ollama model name is blank', async () => {
          const config: AIConfig = { provider: 'ollama', ollamaModel: '   ' };
          (storageService.get as any).mockReturnValue(config);

          const result = await aiService.testProviderConnection();
          expect(result.ok).toBe(false);
          expect(result.stage).toBe('config');
          expect(result.message).toContain('not configured');
      });

      it('successfully tests Ollama connection with inference', async () => {
          const config: AIConfig = { provider: 'ollama', ollamaModel: 'llama3' };
          (storageService.get as any).mockReturnValue(config);

          // Mock /api/tags
          (global.fetch as any).mockResolvedValueOnce({
              ok: true,
              json: () => Promise.resolve({ models: [{ name: 'llama3' }] })
          });

          // Mock /api/chat (inference test)
          (global.fetch as any).mockResolvedValueOnce({
              ok: true,
              json: () => Promise.resolve({ 
                message: {
                  content: JSON.stringify({ ok: true })
                }
              })
          });

          const result = await aiService.testProviderConnection();
          expect(result.ok).toBe(true);
          expect(result.stage).toBe('inference');
          expect(result.message).toContain('Successfully connected to Ollama');
      });

      it('returns model error if Ollama model missing from tags', async () => {
          const config: AIConfig = { provider: 'ollama', ollamaModel: 'missing-model' };
          (storageService.get as any).mockReturnValue(config);

          (global.fetch as any).mockResolvedValue({
              ok: true,
              json: () => Promise.resolve({ models: [{ name: 'llama3' }] })
          });

          const result = await aiService.testProviderConnection();
          expect(result.ok).toBe(false);
          expect(result.stage).toBe('model');
          expect(result.message).toContain('not found in Ollama');
      });

      it('returns service error if Ollama server unreachable', async () => {
          const config: AIConfig = { provider: 'ollama', ollamaBaseUrl: 'http://invalid:11434', ollamaModel: 'llama3' };
          (storageService.get as any).mockReturnValue(config);

          (global.fetch as any).mockRejectedValue(new TypeError('Failed to fetch'));

          const result = await aiService.testProviderConnection();
          expect(result.ok).toBe(false);
          expect(result.stage).toBe('service');
          expect(result.message).toContain('reach');
      });

      it('uses the same no-time-limit request path during Ollama model testing', async () => {
          const config: AIConfig = { provider: 'ollama', ollamaModel: 'llama3' };
          (storageService.get as any).mockReturnValue(config);

          (global.fetch as any).mockResolvedValueOnce({
              ok: true,
              json: () => Promise.resolve({ models: [{ name: 'llama3' }] })
          });

          (global.fetch as any).mockResolvedValueOnce({
              ok: true,
              json: () => Promise.resolve({ 
                message: {
                  content: JSON.stringify({ ok: true })
                }
              })
          });

          const result = await aiService.testProviderConnection();
          expect(result.ok).toBe(true);
          expect(global.fetch).toHaveBeenNthCalledWith(
            2,
            'http://localhost:11434/api/chat',
            expect.not.objectContaining({ signal: expect.anything() })
          );
      });
  });
});
