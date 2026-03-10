import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { FilterBuilder } from '../FilterBuilder';
import { FilterGroup } from '../types/queryTypes';

describe('FilterBuilder', () => {
    const mockOnChange = vi.fn();
    
    const initialGroup: FilterGroup = {
        id: 'root',
        operator: 'AND',
        rules: [
            { id: 'r1', field: 'title', operator: 'contains', value: 'test' }
        ]
    };

    const baseProps = {
        rootGroup: initialGroup,
        onChange: mockOnChange,
        customFields: [{ id: 'cf1', label: 'My Custom Field', type: 'text' }] as any,
    };

    it('renders the initial rule correctly', () => {
        render(<FilterBuilder {...baseProps} />);
        
        expect(screen.getByDisplayValue('Title')).toBeInTheDocument();
        expect(screen.getByDisplayValue('contains')).toBeInTheDocument();
        expect(screen.getByDisplayValue('test')).toBeInTheDocument();
    });

    it('changes group operator between AND and OR', () => {
        render(<FilterBuilder {...baseProps} />);
        
        const orBtn = screen.getByText('OR');
        fireEvent.click(orBtn);
        
        expect(mockOnChange).toHaveBeenCalledWith(expect.objectContaining({
            operator: 'OR'
        }));
    });

    it('adds a new rule when "Add Rule" is clicked', () => {
        render(<FilterBuilder {...baseProps} />);
        
        fireEvent.click(screen.getByText(/Add Rule/i));
        
        expect(mockOnChange).toHaveBeenCalledWith(expect.objectContaining({
            rules: expect.arrayContaining([
                expect.objectContaining({ id: 'r1' }),
                expect.objectContaining({ field: 'title', value: '' })
            ])
        }));
    });

    it('adds a new group when "Add Group" is clicked', () => {
        render(<FilterBuilder {...baseProps} />);
        
        fireEvent.click(screen.getByText(/Add Group/i));
        
        const lastCall = mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1][0];
        const newGroup = lastCall.rules.find((r: any) => 'rules' in r);
        expect(newGroup).toBeDefined();
        expect(newGroup.operator).toBe('AND');
    });

    it('removes a rule when X is clicked', () => {
        render(<FilterBuilder {...baseProps} />);
        
        fireEvent.click(screen.getByLabelText(/Remove filter rule/i));
        
        expect(mockOnChange).toHaveBeenCalledWith(expect.objectContaining({
            rules: []
        }));
    });

    it('updates rule field and operator', () => {
        render(<FilterBuilder {...baseProps} />);
        
        const fieldSelect = screen.getByLabelText('Filter field');
        fireEvent.change(fieldSelect, { target: { value: 'status' } });
        
        expect(mockOnChange).toHaveBeenCalledWith(expect.objectContaining({
            rules: [expect.objectContaining({ field: 'status', operator: 'equals' })]
        }));
    });

    it('updates rule value', () => {
        render(<FilterBuilder {...baseProps} />);
        
        const valueInput = screen.getByPlaceholderText('Value...');
        fireEvent.change(valueInput, { target: { value: 'new value' } });
        
        expect(mockOnChange).toHaveBeenCalledWith(expect.objectContaining({
            rules: [expect.objectContaining({ value: 'new value' })]
        }));
    });

    it('supports custom fields', () => {
        render(<FilterBuilder {...baseProps} />);
        
        const fieldSelect = screen.getByLabelText('Filter field');
        fireEvent.change(fieldSelect, { target: { value: 'cf:cf1' } });
        
        expect(mockOnChange).toHaveBeenCalledWith(expect.objectContaining({
            rules: [expect.objectContaining({ field: 'customField', customFieldId: 'cf1' })]
        }));
    });
});
