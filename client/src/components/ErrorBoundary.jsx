import { Component } from "react";
import { reportError } from "../lib/reportError";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error(error);
    reportError(error, { source: "react", componentStack: info?.componentStack });
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback;
    return (
      <div className={this.props.className || "app-error"} role="alert">
        <p>
          {this.props.message ||
            "Не удалось показать этот блок. Обновите страницу."}
        </p>
      </div>
    );
  }
}
