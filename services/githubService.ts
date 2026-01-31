import { GistResponse } from '../types';

const GITHUB_API_URL = 'https://api.github.com/gists';

export const createOrUpdateGist = async (
  token: string,
  filename: string,
  content: string,
  description: string,
  gistId?: string
): Promise<GistResponse> => {
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };

  const baseBody = {
    description,
    files: {
      [filename]: {
        content,
      },
    },
  };

  // Only include 'public' field when creating a new Gist (POST)
  const body = gistId 
    ? baseBody 
    : { ...baseBody, public: false };

  const url = gistId ? `${GITHUB_API_URL}/${gistId}` : GITHUB_API_URL;
  const method = gistId ? 'PATCH' : 'POST';

  const response = await fetch(url, {
    method,
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || 'Failed to communicate with GitHub');
  }

  return response.json();
};
