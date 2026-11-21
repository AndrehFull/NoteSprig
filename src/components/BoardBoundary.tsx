import { Component, type ReactNode } from 'react';
import { t } from '../i18n';
export class BoardBoundary extends Component<{children:ReactNode;onRecovery:()=>void},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?<section className="welcome-state" role="alert"><p>{t('Drawing dependencies are unavailable. Your draft is preserved. Reconnect and reload when you are ready.')}</p><button onClick={this.props.onRecovery}>{t('Private recovery')}</button></section>:this.props.children;}
}
