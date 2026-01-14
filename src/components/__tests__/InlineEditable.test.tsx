import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InlineEditable } from '../InlineEditable';
import React from 'react';

describe('InlineEditable', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    it('should render initial value in a span', () => {
        render(<InlineEditable value="Test Value" onSave={() => { }} />);
        const span = screen.getByText('Test Value');
        expect(span.tagName).toBe('SPAN');
    });

    it('should switch to input on click', () => {
        render(<InlineEditable value="Test Value" onSave={() => { }} />);
        fireEvent.click(screen.getByText('Test Value'));

        const input = screen.getByDisplayValue('Test Value');
        expect(input.tagName).toBe('INPUT');
    });

    it('should call onSave when Enter is pressed', () => {
        const onSave = vi.fn();
        render(<InlineEditable value="Test Value" onSave={onSave} />);
        fireEvent.click(screen.getByText('Test Value'));

        const input = screen.getByDisplayValue('Test Value');
        fireEvent.change(input, { target: { value: 'New Value' } });
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

        expect(onSave).toHaveBeenCalledWith('New Value');
        expect(screen.queryByDisplayValue('New Value')).not.toBeInTheDocument();
    });

    it('should call onSave on blur after a timeout', async () => {
        const onSave = vi.fn();
        render(<InlineEditable value="Test Value" onSave={onSave} />);
        fireEvent.click(screen.getByText('Test Value'));

        const input = screen.getByDisplayValue('Test Value');
        fireEvent.change(input, { target: { value: 'Blurred Value' } });
        fireEvent.blur(input);

        vi.advanceTimersByTime(200);

        expect(onSave).toHaveBeenCalledWith('Blurred Value');
    });

    it('should cancel and call onCancel when Escape is pressed', () => {
        const onCancel = vi.fn();
        render(<InlineEditable value="Original" onSave={() => { }} onCancel={onCancel} />);
        fireEvent.click(screen.getByText('Original'));

        const input = screen.getByDisplayValue('Original');
        fireEvent.change(input, { target: { value: 'Changed' } });
        fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' });

        expect(onCancel).toHaveBeenCalled();
        expect(screen.getByText('Original')).toBeInTheDocument();
    });

    it('should show placeholder when value is empty', () => {
        render(<InlineEditable value="" onSave={() => { }} placeholder="Custom Placeholder" />);
        expect(screen.getByText('Custom Placeholder')).toBeInTheDocument();
        expect(screen.getByText('Custom Placeholder')).toHaveClass('italic');
    });

    it('should render textarea when multiline is true', () => {
        render(<InlineEditable value="Multi" onSave={() => { }} multiline />);
        fireEvent.click(screen.getByText('Multi'));

        const textarea = screen.getByDisplayValue('Multi');
        expect(textarea.tagName).toBe('TEXTAREA');
    });
});
