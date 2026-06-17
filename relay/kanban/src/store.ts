// src/store.ts — useBoard: board state backed by localStorage

import { useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { Board, Card, Column } from './types';

const STORAGE_KEY = 'relay:board';

const DEFAULT_COLUMNS: Column[] = [
  { id: 'col-new', title: 'New', cardIds: [] },
  { id: 'col-todo', title: 'To-do', cardIds: [] },
  { id: 'col-inprogress', title: 'Inprogress', cardIds: [] },
  { id: 'col-done', title: 'Done', cardIds: [] },
];

function normalizeColumns(columns: Column[] | undefined): Column[] {
  const safeColumns = Array.isArray(columns) ? columns : [];
  const byId = new Map(safeColumns.map((c) => [c.id, c]));

  return DEFAULT_COLUMNS.map((def) => {
    const existing = byId.get(def.id);
    if (existing) {
      return {
        ...existing,
        title: def.title,
        cardIds: Array.isArray(existing.cardIds) ? existing.cardIds : [],
      };
    }
    return { ...def, cardIds: [] };
  });
}

function loadBoard(): Board {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Board;
      return {
        ...parsed,
        columns: normalizeColumns(parsed.columns),
        cards: parsed.cards ?? {},
      };
    }
  } catch { /* ignore */ }
  return { columns: DEFAULT_COLUMNS, cards: {} };
}

function saveBoard(board: Board) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
}

export function useBoard() {
  const [board, setBoard] = useState<Board>(loadBoard);

  const update = useCallback((next: Board) => {
    saveBoard(next);
    setBoard(next);
  }, []);

  // ── Columns ──────────────────────────────────────────────────────────────

  const addColumn = useCallback((title: string) => {
    setBoard((b) => {
      const col: Column = { id: uuidv4(), title, cardIds: [] };
      const next = { ...b, columns: [...b.columns, col] };
      saveBoard(next);
      return next;
    });
  }, []);

  const renameColumn = useCallback((colId: string, title: string) => {
    setBoard((b) => {
      const next = {
        ...b,
        columns: b.columns.map((c) => (c.id === colId ? { ...c, title } : c)),
      };
      saveBoard(next);
      return next;
    });
  }, []);

  const deleteColumn = useCallback((colId: string) => {
    setBoard((b) => {
      const col = b.columns.find((c) => c.id === colId);
      if (!col) return b;
      const cards = { ...b.cards };
      col.cardIds.forEach((id) => delete cards[id]);
      const next = { ...b, columns: b.columns.filter((c) => c.id !== colId), cards };
      saveBoard(next);
      return next;
    });
  }, []);

  // ── Cards ────────────────────────────────────────────────────────────────

  const addCard = useCallback(
    (colId: string, partial: Partial<Card> & { title: string }) => {
      const now = new Date().toISOString();
      const card: Card = {
        id: uuidv4(),
        source: 'user',
        completed: false,
        createdAt: now,
        updatedAt: now,
        ...partial,
      };
      setBoard((b) => {
        const next: Board = {
          columns: b.columns.map((c) =>
            c.id === colId ? { ...c, cardIds: [...c.cardIds, card.id] } : c
          ),
          cards: { ...b.cards, [card.id]: card },
        };
        saveBoard(next);
        return next;
      });
      return card.id;
    },
    []
  );

  const updateCard = useCallback((cardId: string, patch: Partial<Card>) => {
    setBoard((b) => {
      const existing = b.cards[cardId];
      if (!existing) return b;
      const now = new Date().toISOString();
      let cards: Record<string, Card> = {
        ...b.cards,
        [cardId]: { ...existing, ...patch, updatedAt: now },
      };
      let columns = b.columns;

      // When an action item (subtask) completion flips, reconcile the parent:
      // close it once every action item is done, reopen it if one is unchecked.
      const updated = cards[cardId];
      if (updated.parentId && Object.prototype.hasOwnProperty.call(patch, 'completed')) {
        const parentId = updated.parentId;
        const parent = cards[parentId];
        if (parent) {
          const siblings = Object.values(cards).filter((c) => c.parentId === parentId);
          const allDone = siblings.length > 0 && siblings.every((c) => c.completed);
          if (allDone && !parent.completed) {
            cards = { ...cards, [parentId]: { ...parent, completed: true, updatedAt: now } };
            // Close it: move to Done.
            columns = columns.map((c) => ({
              ...c,
              cardIds: c.cardIds.filter((id) => id !== parentId),
            }));
            columns = columns.map((c) =>
              c.id === 'col-done' ? { ...c, cardIds: [...c.cardIds, parentId] } : c
            );
          } else if (!allDone && parent.completed) {
            // Other tasks still open — keep the card open.
            cards = { ...cards, [parentId]: { ...parent, completed: false, updatedAt: now } };
          }
        }
      }

      const next: Board = { ...b, columns, cards };
      saveBoard(next);
      return next;
    });
  }, []);

  const deleteCard = useCallback((cardId: string) => {
    setBoard((b) => {
      const cards = { ...b.cards };
      // Also delete subtasks
      Object.keys(cards).forEach((id) => {
        if (cards[id].parentId === cardId) delete cards[id];
      });
      delete cards[cardId];
      const next: Board = {
        columns: b.columns.map((c) => ({
          ...c,
          cardIds: c.cardIds.filter((id) => id !== cardId),
        })),
        cards,
      };
      saveBoard(next);
      return next;
    });
  }, []);

  const moveCard = useCallback(
    (cardId: string, toColId: string, toIndex: number) => {
      setBoard((b) => {
        const fromCol = b.columns.find((c) => c.cardIds.includes(cardId));
        if (!fromCol) return b;
        const toCol = b.columns.find((c) => c.id === toColId);
        if (!toCol) return b;

        const fromIds = fromCol.cardIds.filter((id) => id !== cardId);
        let toIds =
          fromCol.id === toColId
            ? fromIds
            : toCol.cardIds.filter((id) => id !== cardId);
        toIds = [...toIds.slice(0, toIndex), cardId, ...toIds.slice(toIndex)];

        const next: Board = {
          ...b,
          columns: b.columns.map((c) => {
            if (c.id === fromCol.id && c.id === toColId) return { ...c, cardIds: toIds };
            if (c.id === fromCol.id) return { ...c, cardIds: fromIds };
            if (c.id === toColId) return { ...c, cardIds: toIds };
            return c;
          }),
        };
        saveBoard(next);
        return next;
      });
    },
    []
  );

  // ── Subtasks ─────────────────────────────────────────────────────────────

  const addSubtask = useCallback(
    (parentId: string, title: string) => {
      const now = new Date().toISOString();
      const card: Card = {
        id: uuidv4(),
        title,
        source: 'user',
        parentId,
        completed: false,
        createdAt: now,
        updatedAt: now,
      };
      setBoard((b) => {
        const next: Board = { ...b, cards: { ...b.cards, [card.id]: card } };
        saveBoard(next);
        return next;
      });
      return card.id;
    },
    []
  );

  const getSubtasks = useCallback(
    (parentId: string) =>
      Object.values(board.cards).filter((c) => c.parentId === parentId),
    [board]
  );

  // ── Delegation ─────────────────────────────────────────────────────────────

  // Assign a card to another user and (optionally) attach action items for them.
  // The card stays on the owner's board; the `assigneeId` + `delegatedAt` mark it
  // as delegated. Action items are created as subtasks assigned to the delegate,
  // so completing them flows through the same auto-close logic in updateCard.
  const delegateCard = useCallback(
    (cardId: string, assigneeId: string, actionItems: string[] = []) => {
      const now = new Date().toISOString();
      setBoard((b) => {
        const existing = b.cards[cardId];
        if (!existing) return b;
        const cards: Record<string, Card> = {
          ...b.cards,
          [cardId]: { ...existing, assigneeId, delegatedAt: now, updatedAt: now },
        };
        for (const title of actionItems) {
          const trimmed = title.trim();
          if (!trimmed) continue;
          const id = uuidv4();
          cards[id] = {
            id,
            title: trimmed,
            source: 'user',
            parentId: cardId,
            assigneeId,
            completed: false,
            createdAt: now,
            updatedAt: now,
          };
        }
        const next: Board = { ...b, cards };
        saveBoard(next);
        return next;
      });
    },
    []
  );

  return {
    board,
    update,
    addColumn,
    renameColumn,
    deleteColumn,
    addCard,
    updateCard,
    deleteCard,
    moveCard,
    addSubtask,
    getSubtasks,
    delegateCard,
  };
}
