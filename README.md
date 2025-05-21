# Plan Explorer

Plan Explorer is a modern web application for visualizing PostgreSQL query plans across multi-dimensional parameter spaces. Inspired by the Picasso database query optimizer visualizer, this tool allows users to explore how PostgreSQL's query planner chooses different execution plans based on query parameters and cost settings—all within the browser, without requiring a separate database server.

## Features
- **No Backend Required**: All computation and visualization happen client-side. Uses [PGlite](https://pglite.dev/), a WebAssembly build of PostgreSQL, to run queries and generate plans directly in your browser.
- **Flexible Search Space**: Define one- or two-dimensional parameter spaces (e.g., predicate selectivity, cost parameters) to iterate over.
- **Custom SQL Queries**: Input your own SQL queries with placeholders for dynamic parameters.
- **Plan Fingerprinting**: Automatically groups and colors similar query plans for easy visualization.

## Example Use Cases
- Visualize when PostgreSQL switches from a table scan to an index scan as selectivity or cost parameters change.
- Explore the impact of `random_page_cost` and other planner settings on query plan selection.
- Analyze complex queries, such as self-joins, and observe how the planner chooses among multiple strategies.

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or newer recommended)
- [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/)

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/jnidzwetzki/planexplorer.git
   cd planexplorer
   ```
2. **Install dependencies:**
   ```bash
   npm install
   # or
   yarn install
   ```
3. **Start the development server:**
   ```bash
   npm run dev
   # or
   yarn dev
   ```
4. **Open your browser:**
   Visit [http://localhost:3000](http://localhost:3000) to use the app.

### Build for Production

```bash
npm run build
npm start
```

## Usage

1. **Define Search Space**: Set up to two dimensions (ranges and steps) for the parameters you want to explore.
2. **Database Setup**: Enter SQL statements to prepare your database (e.g., create tables, insert data).
3. **Query Input**: Write your SQL query using placeholders (`%%DIMENSION0%%`, `%%DIMENSION1%%`) for dynamic parameters.
4. **Run**: Execute the analysis and view the resulting plan visualization.

## Example

To see the tool in action, visit the live demo: [https://jnidzwetzki.github.io/planexplorer/](https://jnidzwetzki.github.io/planexplorer/)

## Technologies Used
- [React](https://react.dev/) (with TypeScript)
- [PGlite](https://pglite.dev/) (PostgreSQL in WebAssembly)

## License

This project is open source. See [LICENSE](LICENSE) for details.

## Acknowledgements
- Inspired by [Picasso: The Database Query Optimizer Visualizer](https://dl.acm.org/doi/10.14778/1920841.1921027)
- Built with the help of GitHub Copilot and VS Code agent mode
