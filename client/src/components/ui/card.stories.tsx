import type { Meta, StoryObj } from '@storybook/react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './card';

const meta = {
  title: 'UI/Card',
  component: Card,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Card style={{ width: '350px' }}>
      <CardHeader>
        <CardTitle>Card Title</CardTitle>
        <CardDescription>Card description goes here</CardDescription>
      </CardHeader>
      <CardContent>
        <p>This is the card content. You can put any content here.</p>
      </CardContent>
      <CardFooter>
        <p>Card footer content</p>
      </CardFooter>
    </Card>
  ),
};

export const Simple: Story = {
  render: () => (
    <Card style={{ width: '350px' }}>
      <CardContent>
        <p>Simple card with just content</p>
      </CardContent>
    </Card>
  ),
};

export const WithActions: Story = {
  render: () => (
    <Card style={{ width: '350px' }}>
      <CardHeader>
        <CardTitle>Project Alpha</CardTitle>
        <CardDescription>Active project</CardDescription>
      </CardHeader>
      <CardContent>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Progress</span>
          <span>75%</span>
        </div>
      </CardContent>
      <CardFooter style={{ display: 'flex', gap: '0.5rem' }}>
        <button style={{ padding: '0.5rem 1rem', borderRadius: '0.25rem', border: '1px solid #e5e7eb', background: 'white', cursor: 'pointer' }}>
          View
        </button>
        <button style={{ padding: '0.5rem 1rem', borderRadius: '0.25rem', border: '1px solid #e5e7eb', background: 'white', cursor: 'pointer' }}>
          Edit
        </button>
      </CardFooter>
    </Card>
  ),
};