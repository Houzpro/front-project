import { render, screen } from '@testing-library/react';
import App from './App';

test('renders chat header', () => {
  render(<App />);
  const header = screen.getByText(/Чат-мессенджер/i);
  expect(header).toBeInTheDocument();
});
