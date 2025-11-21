# Design Guidelines: Manufacturing Inventory Management System

## Design Approach
**Selected Framework**: Carbon Design System (IBM)
**Rationale**: Purpose-built for data-intensive enterprise applications with complex workflows, extensive table/form patterns, and operational dashboards. Optimized for productivity and information density.

## Typography System
- **Primary Font**: IBM Plex Sans (via Google Fonts CDN)
- **Monospace Font**: IBM Plex Mono (for SKUs, barcodes, quantities)

**Hierarchy**:
- Page Titles: text-2xl font-semibold (32px)
- Section Headers: text-xl font-medium (24px)
- Card/Panel Titles: text-lg font-medium (20px)
- Body Text: text-base (16px)
- Labels/Metadata: text-sm (14px)
- Helper Text: text-xs (12px)
- Numeric Data: font-mono for SKUs, quantities, dates

## Layout System
**Spacing Primitives**: Tailwind units of 2, 4, 6, and 8
- Component padding: p-4, p-6
- Section gaps: gap-4, gap-6
- Margins: m-2, m-4, m-8
- Grid spacing: space-y-6

**Grid Structure**:
- Dashboard: 12-column grid with responsive breakpoints
- Data tables: Full-width with horizontal scroll on mobile
- Forms: 2-column layout on desktop (grid-cols-2), single column on mobile
- Metric cards: 4-column grid on desktop (grid-cols-1 md:grid-cols-2 lg:grid-cols-4)

## Component Library

### Dashboard Components
**Metrics Panel** (Top of dashboard):
- 4-column grid with KPI cards
- Each card: Large numeric value (text-3xl font-bold), label below (text-sm), trend indicator with icon
- Include: Current Inventory Value, Days Until Stockout, Production Capacity, Active Alerts

**Forecast Section**:
- Prominent alert card with warning indicator
- Large text displaying constraint message
- Timeline visualization showing stockout projection

**At-Risk Items Table**:
- Compact table with 5 rows
- Columns: Item Name, SKU, Current Stock, Daily Usage, Days of Cover, Action Button
- Status indicators using badge components
- Inline "Order Now" buttons

**Production Capacity Calculator**:
- Card displaying maximum producible units
- Breakdown table of constraining components
- Progress bars showing % of required components available

**Supplier Quick-Order Panel**:
- Grid of supplier cards (grid-cols-2 lg:grid-cols-3)
- Each card: Supplier logo placeholder, name, "Open Catalog" button
- Buttons open supplier URLs in new tabs

**Integration Health Status**:
- Horizontal status bar with integration icons
- Color-coded status indicators (visual indicators, not color names)
- Last sync timestamp for each service
- Alert badges for stale/failing integrations

### Products/BOM Builder
**Product List View**:
- Data table with columns: Product Name, SKU, Components Count, Last Modified, Actions
- Search/filter bar above table
- "Create New Product" button (prominent, top-right)

**BOM Editor**:
- Two-panel layout: Product details (left) and Component requirements (right)
- Component requirements as editable table with quantity inputs
- Add/remove component rows with inline controls
- Visual summary showing total component cost

### Barcode Management
**Barcode Grid View**:
- 3-column grid on desktop (grid-cols-1 md:grid-cols-2 lg:grid-cols-3)
- Each card contains:
  - Barcode image placeholder (aspect-ratio-[3/1])
  - Item/bin name (font-medium)
  - SKU or bin code (font-mono text-sm)
  - Purpose badge
  - Action buttons: Download, Print, Edit

**Print Layout**:
- Clean, ink-efficient design
- 2-column layout for multiple barcodes per page
- Each barcode: Centered image, name below, SKU below that
- Page breaks between groups

### Settings Page
**Tabbed Interface**:
- Horizontal tabs: Account, Integrations, LLM Configuration
- Active tab indication with border treatment

**Integration Configuration Cards**:
- One card per service (GoHighLevel, Shopify, Extensiv, PhantomBuster)
- Each card: Service logo/name, API key input (masked), Test Connection button, Status indicator
- Form layout: labels above inputs, helper text below

**LLM Provider Selection**:
- Dropdown/radio group for provider selection
- Conditional API key inputs based on selection
- Feature toggles with clear labels:
  - "Enable LLM order recommendations"
  - "Enable supplier ranking"
  - "Enable demand forecasting"

### Forms & Inputs
**Standard Form Pattern**:
- Label above input (font-medium text-sm)
- Input field with border, padding p-2
- Helper text below (text-xs)
- Error states with inline validation messages

**Barcode Scanner Input**:
- Large, prominent input field when scanning active
- Auto-focus on page load
- Visual feedback during scan processing
- Quick-clear button

### Navigation
**Sidebar Navigation** (persistent on desktop):
- Full-height sidebar with logo at top
- Navigation items: Dashboard, Products, Barcodes, Settings
- Icon + label for each item
- Active state indication
- Collapse to icon-only on tablets

**Top Bar**:
- User profile dropdown (right side)
- System notifications icon with badge count
- Quick search (expandable on click)

### Data Tables
**Standard Table Pattern**:
- Compact row height (h-12)
- Alternating row treatment for readability
- Sticky header on scroll
- Sortable columns with indicator icons
- Inline action buttons (icon-only for space efficiency)
- Pagination controls at bottom

### Buttons & Actions
**Button Hierarchy**:
- Primary actions: Solid buttons (px-4 py-2)
- Secondary actions: Outlined buttons
- Tertiary/Inline: Text buttons with icon
- Danger actions: Distinct visual treatment

**Icon Usage**:
- Use Heroicons throughout (via CDN)
- 20px icons for buttons, 24px for headers
- Pair icons with labels in primary navigation
- Icon-only for space-constrained inline actions

## Responsive Behavior
**Breakpoints**:
- Mobile: Single column, stacked cards, hamburger navigation
- Tablet (768px+): 2-column grids, sidebar navigation visible
- Desktop (1024px+): Full multi-column layouts, expanded sidebar

**Tablet-Specific Optimizations**:
- Larger touch targets (min-h-12 for interactive elements)
- Sufficient spacing between interactive elements (gap-4 minimum)
- Barcode input optimized for scanner integration
- Scrollable tables with horizontal overflow

## Accessibility
- All interactive elements keyboard-navigable
- Focus states visible on all controls
- Form inputs with associated labels (aria-labels)
- Table headers properly marked
- Barcode scanner input with clear focus indication
- Screen reader text for icon-only buttons

## Print Considerations
**Barcode Print Styles**:
- @media print styles for barcode pages
- Remove navigation, headers, footers
- High-contrast, black-and-white optimized
- Proper page breaks
- Margins optimized for standard A4/Letter paper