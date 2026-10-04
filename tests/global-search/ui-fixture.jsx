import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, useLocation } from 'react-router-dom';
import { Context } from 'search-test-auth';
import GlobalSearch from '../../src/components/shared/GlobalSearch.jsx';

function RouteObserver() {
  const location = useLocation();
  return <output data-search-route>{location.pathname}{location.search}</output>;
}

function Fixture() {
  const [profile, setProfile] = useState({ id: 'owner-one', role: 'owner', company_id: 'company-one', is_active: true });
  window.setSearchProfile = setProfile;
  return <Context.Provider value={{ profile }}><BrowserRouter>
    <button aria-label="Outside search">Another action</button>
    <GlobalSearch onCloseSidebar={() => { window.sidebarClosed = (window.sidebarClosed || 0) + 1; }} />
    <RouteObserver />
  </BrowserRouter></Context.Provider>;
}

window.searchRequests = [];
createRoot(document.getElementById('root')).render(<Fixture />);
