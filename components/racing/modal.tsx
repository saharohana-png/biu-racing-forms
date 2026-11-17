'use client';
import { useEffect, useId, useRef, type ReactNode } from 'react';

// Nested dialogs share a lock so closing one cannot unlock the page underneath.
let openDialogs=0;
let originalOverflow='';
function lockPage(){
 if(openDialogs++===0){originalOverflow=document.body.style.overflow;document.body.style.overflow='hidden';}
 let released=false;
 return()=>{if(released)return;released=true;if(--openDialogs===0)document.body.style.overflow=originalOverflow;};
}

export function Modal({title,onClose,children,wide=false}:{title:string;onClose:()=>void;children:ReactNode;wide?:boolean}){
 const ref=useRef<HTMLDialogElement>(null);
 const headingRef=useRef<HTMLHeadingElement>(null);
 const backdropStart=useRef(false);
 const titleId=useId();
 useEffect(()=>{
  const dialog=ref.current;
  if(!dialog)return;
  const opener=document.activeElement instanceof HTMLElement?document.activeElement:null;
  dialog.showModal();
  const unlock=lockPage();
  // Long dialogs begin at their title instead of jumping to a form control.
  headingRef.current?.focus({preventScroll:true});
  return()=>{dialog.close();unlock();if(opener?.isConnected)opener.focus({preventScroll:true});};
 },[]);
 return <dialog ref={ref} className={`modal ${wide?'wide':''}`} aria-labelledby={titleId} aria-modal="true"
  onCancel={event=>{event.preventDefault();onClose();}}
  onPointerDown={event=>{backdropStart.current=event.target===event.currentTarget;}}
  onClick={event=>{const close=backdropStart.current&&event.target===event.currentTarget;backdropStart.current=false;if(close)onClose();}}>
  <div className="modal-content"><header className="modal-heading"><h2 ref={headingRef} id={titleId} tabIndex={-1}>{title}</h2><button type="button" className="icon-button" aria-label={`סגירת ${title}`} onClick={onClose}>×</button></header>{children}</div>
 </dialog>;
}
