import { Page, Empty } from '../components/ui';

export default function Simple({ title, note }: { title: string; note: string }) {
  return (
    <Page title={title}>
      <Empty>{note}</Empty>
    </Page>
  );
}
