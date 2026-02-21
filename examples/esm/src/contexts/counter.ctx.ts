import { defineContext } from "hctx";

// Typed data interface for the counter context
type Data = {
  count: number;
};

// defineContext provides type inference for the context callback
export default defineContext<Data>(() => ({
  data: { count: 0 },
  actions: {
    increment: ({ data }) => {
      data.count++;
    },
    decrement: ({ data }) => {
      data.count--;
    },
    reset: ({ data }) => {
      data.count = 0;
    },
  },
  effects: {
    render: {
      handle: ({ data, el }) => {
        el.textContent = String(data.count);
      },
      subscribe: ({ add, data }) => {
        add(data, "count");
      },
    },
  },
}));
