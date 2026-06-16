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
      const next: Board = {
        ...b,
        cards: {
          ...b.cards,
          [cardId]: { ...existing, ...patch, updatedAt: new Date().toISOString() },
        },
      };
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
  };
}
