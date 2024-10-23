import React, { useState, useEffect } from 'react';

import './Songs.css';

interface SpotifyTrack {
  song: string;
  artist: string;
  album: string;
  playCount: number;
  skipCount: number;
  avgSkipTime: number;
  duration: number;
}

interface SortConfig {
  field: keyof SpotifyTrack;
  direction: 'asc' | 'desc';
}

const TRACKS_PER_PAGE_OPTIONS = [5, 10, 20, 40, 80];

const Songs: React.FC = () => {
  // State management
  const [tracks, setTracks] = useState<SpotifyTrack[]>([]);
  const [filteredTracks, setFilteredTracks] = useState<SpotifyTrack[]>([]);
  const [currentTracks, setCurrentTracks] = useState<SpotifyTrack[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [sort, setSort] = useState<SortConfig>({
    field: 'playCount',
    direction: 'desc'
  });

  // Pagination state
  const [tracksPerPage, setTracksPerPage] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [inputPage, setInputPage] = useState('');

  // Derived values
  const totalPages = Math.ceil(filteredTracks.length / tracksPerPage);
  const indexOfLastTrack = currentPage * tracksPerPage;
  const indexOfFirstTrack = indexOfLastTrack - tracksPerPage;

  // Fetch initial data
  useEffect(() => {
    const fetchData = async () => {
      try {
        const localData = localStorage.getItem('spotifyTracks');
        
        if (localData) {
          const jsonData = JSON.parse(localData);
          setTracks(jsonData.data);
          setFilteredTracks(jsonData.data);
        } else {
          const response = await fetch('/spotify_stats.json');
          if (!response.ok) throw new Error('Network response was not ok');
          
          const jsonData = await response.json();
          setTracks(jsonData.data);
          setFilteredTracks(jsonData.data);
          
          localStorage.setItem('spotifyTracks', JSON.stringify(jsonData));
        }
      } catch (error) {
        console.error('Error fetching data:', error);
        window.location.href = '/error-page'; 
      }
    };

    fetchData();
  }, []);

  // Update current tracks when filtered tracks or pagination changes
  useEffect(() => {
    setCurrentTracks(filteredTracks.slice(indexOfFirstTrack, indexOfLastTrack));
  }, [filteredTracks, indexOfFirstTrack, indexOfLastTrack]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT') {
        if (event.key === 'Escape') {
          (target as HTMLInputElement).blur();
          return; // Exit the function
        }
        return; // Exit if focused on an input element
      }
      if (event.key === 'ArrowLeft' && currentPage > 1) {
        goToPage(currentPage - 1);
      } else if (event.key === 'ArrowRight' && currentPage < totalPages) {
        goToPage(currentPage + 1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentPage, totalPages]);

  // Filter and sort tracks
  useEffect(() => {
    const searchTermLower = searchTerm.toLowerCase();
    const filtered = tracks.filter(track =>
      track.song.toLowerCase().includes(searchTermLower) ||
      track.artist.toLowerCase().includes(searchTermLower) ||
      track.album.toLowerCase().includes(searchTermLower)
    );

    const sorted = [...filtered].sort((a, b) => {
      const factor = sort.direction === 'asc' ? 1 : -1;
      const field = sort.field;
      
      if (typeof a[field] === 'number' && typeof b[field] === 'number') {
        const primarySort = ((a[field] as number) - (b[field] as number)) * factor;
        return primarySort !== 0 ? primarySort : (a.duration - b.duration);
      }
      
      const primarySort = (a[field] as string).localeCompare(b[field] as string) * factor;
      return primarySort !== 0 ? primarySort : (a.playCount - b.playCount);
    });

    setFilteredTracks(sorted);
    setCurrentPage(1);
  }, [searchTerm, sort, tracks]);

  // Utility functions
  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const goToPage = (page: number): void => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  const toggleSort = (field: keyof SpotifyTrack): void => {
    setSort(prevSort => ({
      field,
      direction: prevSort.field === field && prevSort.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  // Pagination UI components
  const renderPaginationButton = (pageNum: number): JSX.Element => (
    <button
      key={pageNum}
      onClick={() => goToPage(pageNum)}
      className="px-3 py-2 bg-gray-300 rounded mx-1"
      style={{ fontWeight: pageNum === currentPage ? 'bold' : 'normal' }}
    >
      {pageNum}
    </button>
  );

  const renderPagination = (): JSX.Element[] => {
    const pageNumbers: JSX.Element[] = [];

    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => renderPaginationButton(i + 1));
    }

    // Always show first page
    if (currentPage > 6) {
      pageNumbers.push(renderPaginationButton(1));
      pageNumbers.push(<span key="dots1" className="mx-2">...</span>);
    }

    // Show pages around current page
    for (let i = Math.max(1, currentPage - 5); i <= Math.min(totalPages, currentPage + 5); i++) {
      pageNumbers.push(renderPaginationButton(i));
    }

    // Always show last page
    if (currentPage < totalPages - 5) {
      pageNumbers.push(<span key="dots2" className="mx-2">...</span>);
      pageNumbers.push(renderPaginationButton(totalPages));
    }

    return pageNumbers;
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Spotify Statistics</h1>
      <input
        type="text"
        placeholder="Search tracks, artists, or albums..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        className="flex-2 p-2 border rounded max"
      />

      <div className="overflow-x-auto table-container">
        
        <table className="w-full table-fixed border-collapse bg-white shadow-sm rounded-lg">
          <thead className="bg-gray-50">
            <tr>
              {([['song', 200], ['artist', 200], ['album', 200], ['playCount', 10], ['skipCount', 10], ['duration', 10], ['avgSkipTime', 10]] as const).map(field => (
                <th 
                  key={field[0]}
                  className="p-3 text-left cursor-pointer hover:bg-gray-100"
                  style={{ width: field[1] }}
                  onClick={() => toggleSort(field[0])}
                >
                  {field[0].charAt(0).toUpperCase() + field[0].slice(1).replace(/([A-Z])/g, ' $1')}
                  {sort.field === field[0] && (sort.direction === 'asc' ? ' ↑' : ' ↓')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {currentTracks.map((track, index) => (
              <tr key={`${track.song}-${index}`} className="border-t hover:bg-gray-50">
                <td className="p-3 truncate">{track.song}</td>
                <td className="p-3 truncate">{track.artist}</td>
                <td className="p-3 truncate">{track.album}</td>
                <td className="p-3">{track.playCount.toLocaleString()}</td>
                <td className="p-3">{track.skipCount.toLocaleString()}</td>
                <td className="p-3">{formatDuration(track.duration)}</td>
                <td className="p-3">{formatDuration(track.avgSkipTime)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span>Total Results: {filteredTracks.length}</span>
        <div className="flex items-center">
          <select
            value={tracksPerPage}
            onChange={(e) => setTracksPerPage(Number(e.target.value))}
            className="ml-4 p-2 border rounded"
          >
            {TRACKS_PER_PAGE_OPTIONS.map(option => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          <div className="pagination-controls">{renderPagination()}</div>
        </div>
      </div>

      <form onSubmit={(e) => {
        e.preventDefault();
        const pageNum = parseInt(inputPage);
        if (!isNaN(pageNum)) goToPage(pageNum);
      }} className="mt-4 flex gap-2">
        <input
          type="number"
          className="flex-1 border p-2 rounded"
          placeholder="Go to page..."
          value={inputPage}
          onChange={(e) => setInputPage(e.target.value)}
          min="1"
          max={totalPages}
        />
        <button type="submit" className="px-4 py-2 bg-blue-500 text-white rounded">
          Go
        </button>
      </form>
    </div>
  );
};

export default Songs;