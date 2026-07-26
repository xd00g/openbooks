export const money = (v: string | number | null | undefined) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(Number(v ?? 0));

export const date = (v: string | Date | null | undefined) =>
  v ? new Date(v).toLocaleDateString('en-US') : '';

export const today = () => new Date().toISOString().slice(0, 10);
export const startOfYear = () => `${new Date().getUTCFullYear()}-01-01`;
