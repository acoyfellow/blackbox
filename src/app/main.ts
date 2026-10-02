import { mount } from 'svelte';
import App from './App.svelte';
import './tailwind.css';

const target = document.getElementById('app');
if (target) mount(App, { target });
