// @vitest-environment jsdom
/**
 * The customer form's extra email rows (Sep 2026). A Pro tradie asked to
 * send quotes "to their admin/pay section as well as the CEO"; this is where
 * those addresses are entered. What matters: rows come and go, blanks are
 * dropped, a bad address blocks the save, and nothing else on the form is
 * disturbed by the new field.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';

vi.mock('react-native-keyboard-controller', async () => await import('../test/stubs/keyboardController'));
vi.mock('../theme', async () => await import('../test/stubs/theme'));
vi.mock('react-native-paper', () => {
  const TextInput: any = ({ value, onChangeText, label, error, right }: any) =>
    React.createElement(
      'div',
      null,
      React.createElement('input', {
        'aria-label': label,
        'data-error': error ? 'true' : undefined,
        value: value ?? '',
        onChange: (e: any) => onChangeText?.(e.target.value),
      }),
      right ?? null,
    );
  TextInput.Icon = ({ accessibilityLabel, onPress }: any) =>
    React.createElement('button', { 'aria-label': accessibilityLabel, onClick: onPress }, '×');
  return {
    Portal: ({ children }: any) => React.createElement(React.Fragment, null, children),
    Modal: ({ visible, children }: any) => (visible ? React.createElement('div', null, children) : null),
    Text: ({ children }: any) => React.createElement('span', null, children),
    TextInput,
    Button: ({ children, onPress, disabled, accessibilityLabel }: any) =>
      React.createElement('button', { onClick: onPress, disabled, 'aria-label': accessibilityLabel }, children),
  };
});

import { ContactEditModal, MAX_ADDITIONAL_EMAILS } from './ContactEditModal';

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });
const addAnother = () => fireEvent.click(screen.getByLabelText('Add another email'));
const save = () => fireEvent.click(screen.getByText('Save'));

function renderForm(initial: any = { name: 'Jane Smith', email: 'jane@smith.com' }) {
  const onSave = vi.fn();
  render(<ContactEditModal visible onDismiss={() => {}} onSave={onSave} initial={initial} />);
  return { onSave };
}

describe('ContactEditModal — extra email addresses', () => {
  it('starts with one Email field and an "Add another email" link', () => {
    renderForm();
    expect(field('Email')).toBeTruthy();
    expect(screen.queryByLabelText('Email 2')).toBeNull();
    expect(screen.getByLabelText('Add another email')).toBeTruthy();
  });

  it('reveals a second Email field and saves what goes in it', () => {
    const { onSave } = renderForm();
    addAnother();
    type('Email 2', 'Accounts@Smith.com');
    save();
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'jane@smith.com', additionalEmails: ['accounts@smith.com'] }),
    );
  });

  it('stops offering the link at three extra addresses', () => {
    renderForm();
    for (let i = 0; i < MAX_ADDITIONAL_EMAILS; i++) addAnother();
    expect(screen.getByLabelText(`Email ${MAX_ADDITIONAL_EMAILS + 1}`)).toBeTruthy();
    expect(screen.queryByLabelText('Add another email')).toBeNull();
  });

  it('removes a row with its × and the address goes with it', () => {
    const { onSave } = renderForm();
    addAnother();
    type('Email 2', 'accounts@smith.com');
    addAnother();
    type('Email 3', 'ceo@smith.com');
    fireEvent.click(screen.getByLabelText('Remove email 2'));
    expect(screen.queryByLabelText('Email 3')).toBeNull();
    expect(field('Email 2').value).toBe('ceo@smith.com');
    save();
    expect(onSave.mock.calls[0][0].additionalEmails).toEqual(['ceo@smith.com']);
  });

  it('drops empty rows on save rather than saving blanks', () => {
    const { onSave } = renderForm();
    addAnother();
    addAnother();
    type('Email 3', 'ceo@smith.com');
    save();
    expect(onSave.mock.calls[0][0].additionalEmails).toEqual(['ceo@smith.com']);
  });

  it('saves no extras field at all when every row is blank', () => {
    const { onSave } = renderForm();
    addAnother();
    save();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].additionalEmails).toBeUndefined();
  });

  it('refuses to save a row that is not an email address, and says so on that row', () => {
    const { onSave } = renderForm();
    addAnother();
    type('Email 2', 'accounts at smith');
    save();
    expect(onSave).not.toHaveBeenCalled();
    expect(field('Email 2').getAttribute('data-error')).toBe('true');
    expect(screen.getByText("That doesn't look like an email address.")).toBeTruthy();
  });

  it('lets the save through once the bad row is fixed', () => {
    const { onSave } = renderForm();
    addAnother();
    type('Email 2', 'accounts at smith');
    save();
    type('Email 2', 'accounts@smith.com');
    save();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("That doesn't look like an email address.")).toBeNull();
  });

  it('seeds the rows from a contact that already has extras', () => {
    renderForm({ name: 'Jane Smith', email: 'jane@smith.com', additionalEmails: ['accounts@smith.com', 'ceo@smith.com'] });
    expect(field('Email 2').value).toBe('accounts@smith.com');
    expect(field('Email 3').value).toBe('ceo@smith.com');
  });

  it('keeps every existing field exactly as entered', () => {
    const { onSave } = renderForm({
      name: 'Jane Smith',
      businessName: 'Smith & Co',
      email: 'jane@smith.com',
      phone: '0400 111 111',
      address: '1 Smith St',
      website: 'smith.com',
      notes: 'Gate code 1234',
    });
    addAnother();
    type('Email 2', 'accounts@smith.com');
    save();
    expect(onSave).toHaveBeenCalledWith({
      name: 'Jane Smith',
      businessName: 'Smith & Co',
      email: 'jane@smith.com',
      additionalEmails: ['accounts@smith.com'],
      phone: '0400 111 111',
      address: '1 Smith St',
      website: 'smith.com',
      notes: 'Gate code 1234',
    });
  });
});
